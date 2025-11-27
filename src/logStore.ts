import { existsSync, promises as fs } from 'fs';
import path from 'path';
import type {
  InteractionLog,
  ListLogsOptions,
  ListLogsResult,
  LogSummary,
} from '../shared/types';
import { appConfig } from './config';
import { logger } from './logger';
import { AnthropicStreamAggregator } from './streamAggregator';
import { globalMetricsWorker } from './workers/metricsWorker';

// Re-export for backward compatibility
export type { ListLogsOptions, ListLogsResult, LogSummary } from '../shared/types';

/**
 * Lightweight storage layer for interaction logs. Each request/response pair is written
 * to disk as a JSON file; these helpers know how to list files, read individual logs,
 * and delete batches. Keeping it separate from the Express handlers makes the API
 * routes very small and easy to reason about.
 */

const LOG_FILE_REGEX = /^[0-9A-Z\-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;

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

/**
 * Ensures response body is hydrated by reconstructing from stream chunks if needed.
 * Returns true if the body was updated.
 */
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

// =============================================================================
// Metadata Computation Functions
// =============================================================================

/**
 * Ensures log metadata (hydrated body) is computed and persisted.
 * Returns true if the log was modified and written to disk.
 *
 * Note: Token usage and agent tags are now computed by MetricsWorker in the background.
 * This function only handles response body hydration from stream chunks.
 */
async function ensureLogMetadata(entry: InteractionLog, filePath: string): Promise<boolean> {
  const bodyUpdated = hydrateResponseBody(entry);

  if (!bodyUpdated) {
    return false;
  }

  try {
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf8');
    logger.debug(
      { fileName: path.basename(filePath), bodyUpdated },
      'persisted hydrated log body to disk'
    );
    return true;
  } catch (error) {
    logger.warn(
      { err: error, fileName: path.basename(filePath) },
      'failed to persist log metadata'
    );
    return false;
  }
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
      timestampMs: entry.timestampMs,
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

    if (entry.agentTag) {
      summary.agentTag = entry.agentTag;
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
  } catch (error) {
    logger.error({ err: error, fileName }, 'failed to get log');
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
}

export async function recomputeLogs(): Promise<RecomputeLogsResult> {
  const logDir = path.resolve(appConfig.logDir);

  if (!ensureLogDirExists(logDir)) {
    return { processed: 0 };
  }

  // Check if metrics worker is available
  if (!globalMetricsWorker) {
    logger.error('recomputeLogs called but MetricsWorker is not initialized');
    throw new Error('MetricsWorker not initialized. Cannot recompute logs.');
  }

  const files = (await fs.readdir(logDir))
    .filter((name) => LOG_FILE_REGEX.test(name));

  logger.info({ totalFiles: files.length }, 'Starting log recomputation using MetricsWorker');

  // Delegate to MetricsWorker's recomputeAll method which processes all logs with force=true
  await globalMetricsWorker.recomputeAll();

  logger.info(
    { processed: files.length },
    'Log recomputation completed'
  );

  return { processed: files.length };
}
