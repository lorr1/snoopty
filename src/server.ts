import express from 'express';
import path from 'path';
import fs from 'fs';
import { appConfig, validateConfig } from './config';
import { ERROR_MESSAGES } from './constants';
import { logger } from './logger';
import { healthRouter, logsRouter, proxyRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';

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

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down proxy server');
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
