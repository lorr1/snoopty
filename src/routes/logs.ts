import { Router } from 'express';
import { logger } from '../logger';
import {
  DEFAULT_LOG_LIMIT,
  MIN_LOG_LIMIT,
  MAX_LOG_LIMIT,
} from '../constants';
import {
  listLogs,
  getLog,
  deleteLogs,
  recomputeLogs,
  type ListLogsOptions,
} from '../logStore';
import { createParquetBuffer, type ParquetRecord } from '../parquetExporter';

const router = Router();

// GET /logs
router.get('/', async (req, res, next) => {
  try {
    const rawLimit = typeof req.query.limit === 'string' ? req.query.limit : undefined;
    const limitValue = rawLimit ? Number.parseInt(rawLimit, 10) : DEFAULT_LOG_LIMIT;
    const limit = Number.isFinite(limitValue)
      ? Math.min(Math.max(limitValue, MIN_LOG_LIMIT), MAX_LOG_LIMIT)
      : DEFAULT_LOG_LIMIT;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    const options: ListLogsOptions = cursor ? { limit, cursor } : { limit };
    const result = await listLogs(options);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /logs/batch - Fetch multiple logs by filenames
router.post('/batch', async (req, res, next) => {
  try {
    const body = req.body as { fileNames?: unknown };
    const fileNames = Array.isArray(body?.fileNames)
      ? body.fileNames.filter((value): value is string => typeof value === 'string')
      : [];

    if (fileNames.length === 0) {
      res.status(400).json({ error: 'fileNames array is required.' });
      return;
    }

    logger.info({ count: fileNames.length }, 'batch logs request received');

    // Fetch all logs in parallel
    const logsPromises = fileNames.map(async (fileName) => {
      const log = await getLog(fileName);
      return log;
    });

    const logs = await Promise.all(logsPromises);
    const validLogs = logs.filter((log) => log !== null);
    const missing = fileNames.filter((_fileName, idx) => logs[idx] === null);

    logger.info(
      { requested: fileNames.length, found: validLogs.length, missing: missing.length },
      'batch logs result'
    );

    res.json({
      logs: validLogs,
      missing: missing.length > 0 ? missing : undefined,
    });
  } catch (error) {
    next(error);
  }
});

// GET /logs/:fileName
router.get('/:fileName', async (req, res, next) => {
  try {
    const { fileName } = req.params;
    const log = await getLog(fileName);
    if (!log) {
      res.status(404).json({ error: 'Log not found' });
      return;
    }
    res.json(log);
  } catch (error) {
    next(error);
  }
});

// DELETE /logs
router.delete('/', async (req, res, next) => {
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

// POST /logs/export
router.post('/export', async (req, res, next) => {
  try {
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
    logger.error({ err: error }, 'export failed');
    next(error);
  }
});

// POST /logs/recompute
router.post('/recompute', async (_req, res, next) => {
  try {
    logger.info('recompute logs request received');
    const result = await recomputeLogs();
    logger.info(result, 'recompute logs result');
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
