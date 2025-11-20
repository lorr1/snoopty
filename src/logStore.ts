import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { appConfig } from './config';
import { logger } from './logger';
import type { InteractionLog, TokenUsageSummary } from './logWriter';
import { AnthropicStreamAggregator } from './streamAggregator';
import { analyzeTokenUsage } from './tokenMetrics';

/**
 * Lightweight storage layer for interaction logs. Each request/response pair is written
 * to disk as a JSON file; these helpers know how to list files, read individual logs,
 * and delete batches. Keeping it separate from the Express handlers makes the API
 * routes very small and easy to reason about.
 */

const LOG_FILE_REGEX = /^[0-9A-Z\-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

export interface LogSummary {
  id: string;
  fileName: string;
  timestamp: string;
  method: string;
  path: string;
  status?: number;
  durationMs?: number;
  model?: string;
  error?: string;
  tokenUsage?: TokenUsageSummary;
}

export interface ListLogsOptions {
  limit: number;
  cursor?: string;
}

export interface ListLogsResult {
  items: LogSummary[];
  nextCursor?: string;
}

async function readInteractionLog(filePath: string): Promise<InteractionLog | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as InteractionLog;
  } catch (error) {
    // Bad or partially written files are skipped but not fatal.
    logger.error({ err: error, filePath }, 'failed to parse log file');
    return null;
  }
}

function hydrateResponseBody(entry: InteractionLog): boolean {
  const response = entry.response;
  if (!response || response.body || !Array.isArray(response.streamChunks) || response.streamChunks.length === 0) {
    return false;
  }
  try {
    const aggregator = new AnthropicStreamAggregator();
    response.streamChunks.forEach((chunk) => {
      if (typeof chunk === 'string') {
        aggregator.ingest(chunk);
      }
    });
    const aggregated = aggregator.finalize();
    if (aggregated) {
      response.body = aggregated;
      return true;
    }
  } catch (error) {
    logger.warn(
      { err: error, entryId: entry.id },
      'failed to reconstruct aggregated stream response'
    );
  }
  return false;
}

function extractModel(entry: InteractionLog): string | undefined {
  const body = entry.request.body;
  if (body && typeof body === 'object' && 'model' in body) {
    const value = (body as Record<string, unknown>).model;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function ensureLogDirExists(dir: string): boolean {
  return existsSync(dir);
}

/**
 * Ensures log metadata (hydrated body and token usage) is computed and persisted.
 * Returns true if the log was modified and written to disk.
 */
async function ensureLogMetadata(entry: InteractionLog, filePath: string): Promise<boolean> {
  const bodyUpdated = hydrateResponseBody(entry);

  let usageUpdated = false;
  if (!entry.tokenUsage) {
    try {
      const tokenUsage = await analyzeTokenUsage(entry);
      if (tokenUsage) {
        entry.tokenUsage = tokenUsage;
        usageUpdated = true;
      }
    } catch (error) {
      logger.error(
        { err: error, entryId: entry.id },
        'failed to analyze token usage'
      );
    }
  }

  if (bodyUpdated || usageUpdated) {
    try {
      await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');
      logger.debug(
        { fileName: path.basename(filePath), bodyUpdated, usageUpdated },
        'persisted log metadata to disk'
      );
      return true;
    } catch (error) {
      logger.warn(
        { err: error, fileName: path.basename(filePath) },
        'failed to persist log metadata'
      );
    }
  }

  return false;
}

export async function listLogs(options: ListLogsOptions): Promise<ListLogsResult> {
  const { limit, cursor } = options;
  const logDir = path.resolve(appConfig.logDir);

  if (!ensureLogDirExists(logDir)) {
    // No log directory yet – return an empty list so the UI stays happy.
    return { items: [] };
  }

  const files = (await fs.readdir(logDir))
    .filter((name) => LOG_FILE_REGEX.test(name))
    .sort((a, b) => b.localeCompare(a)); // newest first

  if (files.length === 0) {
    return { items: [] };
  }

  let startIndex = 0;
  if (cursor) {
    const cursorIndex = files.findIndex((name) => name === cursor);
    if (cursorIndex !== -1) {
      startIndex = cursorIndex + 1;
    }
  }

  const slice = files.slice(startIndex, startIndex + limit);
  const items: LogSummary[] = [];

  for (const fileName of slice) {
    const filePath = path.join(logDir, fileName);
    const entry = await readInteractionLog(filePath);
    if (!entry) {
      continue;
    }

    await ensureLogMetadata(entry, filePath);

    const summary: LogSummary = {
      id: entry.id,
      fileName,
      timestamp: entry.timestamp,
      method: entry.method,
      path: entry.path,
    };

    if (typeof entry.response?.status === 'number') {
      summary.status = entry.response.status;
    }

    if (typeof entry.durationMs === 'number') {
      summary.durationMs = entry.durationMs;
    }

    const model = extractModel(entry);
    if (model) {
      summary.model = model;
    }

    if (entry.response?.error) {
      summary.error = entry.response.error;
    }

    if (entry.tokenUsage) {
      summary.tokenUsage = entry.tokenUsage;
    }

    items.push(summary);
  }

  const nextIndex = startIndex + slice.length;
  const nextCursor = nextIndex < files.length ? files[nextIndex] : undefined;

  return nextCursor ? { items, nextCursor } : { items };
}

export async function getLog(fileName: string): Promise<InteractionLog | null> {
  if (!LOG_FILE_REGEX.test(fileName)) {
    return null;
  }

  const logDir = path.resolve(appConfig.logDir);
  if (!ensureLogDirExists(logDir)) {
    return null;
  }

  const filePath = path.join(logDir, fileName);
  try {
    const entry = await readInteractionLog(filePath);
    if (!entry) {
      return null;
    }

    await ensureLogMetadata(entry, filePath);

    return entry;
  } catch {
    return null;
  }
}

export interface DeleteLogsResult {
  deleted: string[];
  failed: Array<{ fileName: string; error: string }>;
}

export async function deleteLogs(fileNames: string[]): Promise<DeleteLogsResult> {
  const uniqueNames = Array.from(new Set(fileNames));
  const logDir = path.resolve(appConfig.logDir);
  const result: DeleteLogsResult = { deleted: [], failed: [] };

  if (!ensureLogDirExists(logDir) || uniqueNames.length === 0) {
    // Nothing to delete – return an empty report.
    return result;
  }

  for (const fileName of uniqueNames) {
    if (!LOG_FILE_REGEX.test(fileName)) {
      result.failed.push({ fileName, error: 'invalid file name' });
      continue;
    }

    const filePath = path.join(logDir, fileName);
    try {
      await fs.unlink(filePath);
      result.deleted.push(fileName);
    } catch (error) {
      result.failed.push({
        fileName,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  return result;
}

export interface RecomputeLogsResult {
  processed: number;
  updatedBodies: number;
  updatedUsage: number;
  failed: Array<{ fileName: string; error: string }>;
}

export async function recomputeLogs(): Promise<RecomputeLogsResult> {
  const logDir = path.resolve(appConfig.logDir);
  const result: RecomputeLogsResult = {
    processed: 0,
    updatedBodies: 0,
    updatedUsage: 0,
    failed: [],
  };

  if (!ensureLogDirExists(logDir)) {
    return result;
  }

  const files = (await fs.readdir(logDir))
    .filter((name) => LOG_FILE_REGEX.test(name))
    .sort((a, b) => a.localeCompare(b)); // oldest first to avoid hot file churn

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i]!;
    const filePath = path.join(logDir, fileName);
    logger.info(
      { progress: `${i + 1}/${files.length}`, fileName },
      'recomputing log'
    );

    let entry: InteractionLog | null = null;
    try {
      entry = await readInteractionLog(filePath);
    } catch (error) {
      result.failed.push({
        fileName,
        error: error instanceof Error ? error.message : 'failed to read log',
      });
      continue;
    }

    if (!entry) {
      result.failed.push({ fileName, error: 'unable to parse log' });
      continue;
    }

    result.processed += 1;
    const beforeBody = JSON.stringify(entry.response?.body ?? null);
    const beforeUsage = JSON.stringify(entry.tokenUsage ?? null);

    const bodyUpdated = hydrateResponseBody(entry);

    let usageUpdated = false;
    try {
      delete entry.tokenUsage;
      const usageStartTime = Date.now();
      logger.info({ fileName }, 'starting token usage analysis');
      const usage = await analyzeTokenUsage(entry);
      const usageDuration = Date.now() - usageStartTime;
      logger.info({ fileName, duration: usageDuration }, 'finished token usage analysis');
      if (usage) {
        entry.tokenUsage = usage;
        usageUpdated = JSON.stringify(entry.tokenUsage ?? null) !== beforeUsage;
      } else if (beforeUsage !== 'null') {
        delete entry.tokenUsage;
        usageUpdated = true;
      }
    } catch (error) {
      logger.error({ err: error, fileName }, 'token usage analysis failed');
      result.failed.push({
        fileName,
        error: error instanceof Error ? error.message : 'token usage analysis failed',
      });
      continue;
    }

    if (bodyUpdated || usageUpdated) {
      try {
        await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');
        if (bodyUpdated) {
          result.updatedBodies += 1;
        }
        if (usageUpdated) {
          result.updatedUsage += 1;
        }
      } catch (error) {
        result.failed.push({
          fileName,
          error: error instanceof Error ? error.message : 'failed to rewrite log',
        });
      }
    }
  }

  return result;
}
