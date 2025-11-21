import { promises as fs } from 'fs';
import path from 'path';
import { appConfig } from './config';
import { logger } from './logger';

// Re-export shared types for backward compatibility
export type {
  AgentTagId,
  AgentTagInfo,
  AgentTagTheme,
  CustomTokenUsage,
  InputSegmentId,
  InteractionLog,
  OutputSegmentId,
  TokenBreakdown,
  TokenCountDetail,
  TokenMethodology,
  TokenUsageSegment,
  TokenUsageSegmentId,
  TokenUsageSource,
  TokenUsageSummary,
  TokenUsageTotals,
} from '../shared/types';

import type { InteractionLog } from '../shared/types';

const SENSITIVE_HEADERS = new Set(['x-api-key', 'authorization', 'proxy-authorization']);
const DIRECTORY_CACHE = new Set<string>();

function sanitizeHeaderValue(value: string): string {
  return value.length > 2 ? `${value.slice(0, 2)}…` : '••';
}

export function sanitizeHeaders(source: Record<string, string | string[] | undefined>): Record<string, string> {
  return Object.entries(source).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'undefined') {
      return acc;
    }
    const normalizedKey = key.toLowerCase();
    const rawValue = Array.isArray(value) ? value.join(',') : value;
    acc[normalizedKey] = SENSITIVE_HEADERS.has(normalizedKey) ? sanitizeHeaderValue(rawValue) : rawValue;
    return acc;
  }, {});
}

async function ensureLogDirectory(dir: string): Promise<void> {
  if (DIRECTORY_CACHE.has(dir)) {
    return;
  }
  await fs.mkdir(dir, { recursive: true });
  DIRECTORY_CACHE.add(dir);
}

function buildLogFilePath(entry: InteractionLog): string {
  const safeTimestamp = entry.timestamp.replace(/[:.]/g, '-');
  return path.join(appConfig.logDir, `${safeTimestamp}-${entry.id}.json`);
}

/**
 * Writes an interaction log to disk.
 * Returns true if the write succeeded, false otherwise.
 */
export async function writeInteractionLog(entry: InteractionLog): Promise<boolean> {
  try {
    await ensureLogDirectory(appConfig.logDir);
    const filepath = buildLogFilePath(entry);
    const payload = JSON.stringify(entry, null, 2);
    await fs.writeFile(filepath, payload, 'utf8');
    return true;
  } catch (error) {
    logger.error({ err: error, entryId: entry.id }, 'failed to write interaction log');
    return false;
  }
}
