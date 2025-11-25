import express from 'express';
import path from 'path';
import fs from 'fs';
import { appConfig, validateConfig } from './config';
import { ERROR_MESSAGES } from './constants';
import { logger } from './logger';
import { healthRouter, logsRouter, proxyRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { globalMetricsRegistry } from './metrics/MetricsAnalyzer';
import { ToolMetricsAnalyzer } from './metrics/ToolMetricsAnalyzer';
import { TokenBreakdownAnalyzer } from './metrics/TokenBreakdownAnalyzer';
import { AgentTagAnalyzer } from './metrics/AgentTagAnalyzer';
import { startMetricsWorker, stopMetricsWorker } from './workers/metricsWorker';

/**
 * The Express bootstrap lives in this file. We wire up:
 *  - JSON/text body parsing for Anthropic payloads,
 *  - REST endpoints for querying/deleting/exporting interaction logs,
 *  - A reverse proxy that forwards /v1/* traffic to Anthropic,
 *  - The static React UI under /ui.
 *
 * Keeping the setup in one place makes it easy to trace the request flow end-to-end.
 */

/**
 * Register common middleware so all routes accept JSON bodies, plain text bodies
 * (Anthropic streaming is ndjson), and share the same size limits.
 */
function attachMiddleware(app: express.Express): void {
  app.use(
    express.json({
      limit: '15mb',
    })
  );

  app.use(
    express.text({
      type: ['text/*', 'application/x-ndjson'],
      limit: '15mb',
    })
  );
}

/**
 * Attach REST endpoints for the UI and CLI helpers.
 * Everything under /api returns JSON; /v1/* is forwarded to the Anthropic upstream.
 */
function registerRoutes(app: express.Express): void {
  // Health check
  app.use(healthRouter);

  // API routes
  app.use('/api/logs', logsRouter);

  // Anthropic proxy
  app.use('/v1', proxyRouter);

  // Static UI serving
  const projectRoot = path.resolve(__dirname, '..');
  const staticClientPath = path.join(projectRoot, 'dist', 'client');
  const existingClientPath = fs.existsSync(staticClientPath) ? staticClientPath : undefined;

  if (existingClientPath) {
    app.use('/ui', express.static(existingClientPath));
    app.get('/ui', (_req, res) => {
      res.sendFile(path.join(existingClientPath, 'index.html'));
    });
    app.get(/^\/ui\/.+$/, (_req, res) => {
      res.sendFile(path.join(existingClientPath, 'index.html'));
    });
    app.get('/', (_req, res) => {
      res.redirect('/ui');
    });
  }

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({
      error: ERROR_MESSAGES.ROUTE_NOT_FOUND,
    });
  });
}

async function bootstrap(): Promise<void> {
  // Validate configuration up front so we fail fast if required env vars are missing.
  validateConfig();

  logger.info('Bootstrap: Registering metrics analyzers');

  // Register all metrics analyzers
  try {
    const analyzers = [
      new TokenBreakdownAnalyzer(),
      new AgentTagAnalyzer(),
      new ToolMetricsAnalyzer(),
    ];

    for (const analyzer of analyzers) {
      globalMetricsRegistry.register(analyzer);
      logger.info({ analyzer: analyzer.name }, 'Bootstrap: Registered analyzer');
    }
  } catch (error) {
    logger.error({ error }, 'Bootstrap: Error registering metrics analyzers');
    throw error;
  }

  logger.info('Bootstrap: Starting metrics worker');

  // Start the metrics worker
  try {
    await startMetricsWorker({
      processExisting: true,
      watchForNew: true,
      pollInterval: 5000,
    });
    logger.info('Bootstrap: Metrics worker started successfully');
  } catch (error) {
    logger.error({ error }, 'Bootstrap: Error starting metrics worker');
    throw error;
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  attachMiddleware(app);
  registerRoutes(app);
  app.use(errorHandler);

  const server = app.listen(appConfig.port, () => {
    logger.info(
      {
        port: appConfig.port,
        upstreamBaseUrl: appConfig.upstreamBaseUrl,
        logDir: appConfig.logDir,
      },
      'snoopty proxy listening'
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down proxy server');

    // Stop metrics worker first
    try {
      logger.info('Shutdown: Stopping metrics worker');
      await stopMetricsWorker();
      logger.info('Shutdown: Metrics worker stopped');
    } catch (error) {
      logger.error({ error }, 'Shutdown: Error stopping metrics worker');
    }

    // Then close server
    server.close((err) => {
      if (err) {
        logger.error({ err }, 'error while closing server');
        process.exit(1);
      } else {
        process.exit(0);
      }
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'failed to bootstrap proxy');
  process.exit(1);
});
