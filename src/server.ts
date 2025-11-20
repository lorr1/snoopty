import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { appConfig, validateConfig } from './config';
import { logger } from './logger';
import { proxyAnthropicRequest } from './proxy';
import {
  listLogs,
  getLog,
  deleteLogs,
  recomputeLogs,
  type ListLogsOptions,
} from './logStore';
import { createParquetBuffer, type ParquetRecord } from './parquetExporter';
import type { InteractionLog } from './logWriter';

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
  app.get('/health', (_req, res) => {
    res.json({
      service: 'snoopty-proxy',
      status: 'ok',
      upstream: appConfig.upstreamBaseUrl,
    });
  });

  const api = express.Router();

  api.get('/logs', async (req, res, next) => {
    try {
      const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
      const limitValue = rawLimit ? Number.parseInt(rawLimit, 10) : 50;
      const limit = Number.isFinite(limitValue) ? Math.min(Math.max(limitValue, 1), 200) : 50;
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

      const options: ListLogsOptions = cursor ? { limit, cursor } : { limit };
      const result = await listLogs(options);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  api.get('/logs/:fileName', async (req, res, next) => {
    try {
      const { fileName } = req.params;
      const log = await getLog(fileName);
      if (!log) {
        res.status(404).json({ error: 'Log entry not found.' });
        return;
      }
      res.json(log);
    } catch (error) {
      next(error);
    }
  });

  api.delete('/logs', async (req, res, next) => {
    try {
      const body = req.body as { fileNames?: unknown };
      const fileNames = Array.isArray(body?.fileNames)
        ? body.fileNames.filter((value): value is string => typeof value === 'string')
        : [];
      if (fileNames.length === 0) {
        res.status(400).json({ error: 'fileNames array is required.' });
        return;
      }

      logger.info({ fileNames }, 'delete logs request received');

      const result = await deleteLogs(fileNames);
      logger.info(result, 'delete logs result');
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  api.post('/logs/export', async (req, res, next) => {
    try {
      // Convert the provided file names into Parquet rows; keep track of missing logs
      // so the caller can see which entries were skipped.
      const body = req.body as { fileNames?: unknown };
      const fileNames = Array.isArray(body?.fileNames)
        ? body.fileNames.filter((value): value is string => typeof value === 'string')
        : [];

      if (fileNames.length === 0) {
        res.status(400).json({ error: 'fileNames array is required.' });
        return;
      }

      const records: ParquetRecord[] = [];
      const missing: string[] = [];

      for (const fileName of fileNames) {
        const log = await getLog(fileName);
        if (log) {
          records.push({ fileName, entry: log });
        } else {
          missing.push(fileName);
        }
      }

      if (records.length === 0) {
        res.status(404).json({ error: 'No matching logs found for export.' });
        return;
      }

      const buffer = await createParquetBuffer(records);
      const filename = `snoopty-export-${new Date()
        .toISOString()
        .replace(/[:.]/g, '-')}.parquet`;

      if (missing.length > 0) {
        res.setHeader('X-Snoopty-Missing', JSON.stringify(missing));
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from(buffer));
    } catch (error) {
      next(error);
    }
  });

  api.post('/logs/recompute', async (_req, res, next) => {
    try {
      logger.info('recompute logs request received');
      const result = await recomputeLogs();
      logger.info(result, 'recompute logs result');
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.use('/api', api);

  app.use('/v1', async (req, res, next) => {
    try {
      // Hand off to the reverse proxy which injects the API key, records logs,
      // and streams Anthropic responses back to the caller.
      await proxyAnthropicRequest(req, res);
    } catch (error) {
      next(error);
    }
  });

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

  app.use((_req, res) => {
    res.status(404).json({
      error: 'Route not handled by snoopty proxy.',
    });
  });
}

function registerErrorHandler(app: express.Express): void {
  // Centralized error handler ensures we never leak stack traces to the client.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'unhandled server error');
    res.status(500).json({
      error: 'Internal server error.',
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
  registerErrorHandler(app);

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
