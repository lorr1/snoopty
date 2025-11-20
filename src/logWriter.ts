import { promises as fs } from 'fs';
import path from 'path';
import { appConfig } from './config';
import type { AgentTagInfo } from './agentTagger';
import { logger } from './logger';

const SENSITIVE_HEADERS = new Set(['x-api-key', 'authorization', 'proxy-authorization']);
const DIRECTORY_CACHE = new Set<string>();

export interface TokenUsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
}

export type TokenUsageSegmentId = 'system' | 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_return' | 'tool_use';

export interface TokenUsageSegment {
  id: TokenUsageSegmentId;
  label: string;
  tokens: number | null;
  methodology: 'anthropic' | 'estimate' | 'unknown';
}

export interface TokenUsageSource {
  type: 'anthropic-usage';
  event: string;
  usage: Record<string, unknown>;
}

export interface TokenCountDetail {
  tokens: number | null;
  textLength: number;
  segments: number;
  methodology: 'anthropic' | 'estimate' | 'unknown';
  notes?: string;
}

export type InputSegmentId = 'system' | 'user' | 'tool' | 'tool_return';
export type OutputSegmentId = 'assistant' | 'thinking' | 'tool_use';

export interface TokenBreakdown {
  segments: Record<string, TokenCountDetail>;
  totalTokens: number | null;
}

export interface CustomTokenUsage {
  provider: string;
  methodology: 'anthropic' | 'estimate' | 'unknown';
  input: TokenBreakdown;
  output: TokenBreakdown;
  totalTokens: number | null;
  errors?: string[];
}

export interface TokenUsageSummary {
  totals: TokenUsageTotals;
  segments: TokenUsageSegment[];
  sources: TokenUsageSource[];
  custom?: CustomTokenUsage;
}

export interface InteractionLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  query: string;
  durationMs?: number;
  request: {
    headers: Record<string, string>;
    body?: unknown;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: unknown;
    streamChunks?: string[];
    error?: string;
  };
  tokenUsage?: TokenUsageSummary;
  agentTag?: AgentTagInfo;
}

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

export async function writeInteractionLog(entry: InteractionLog): Promise<void> {
  try {
    await ensureLogDirectory(appConfig.logDir);
    const filepath = buildLogFilePath(entry);
    const payload = JSON.stringify(entry, null, 2);
    await fs.writeFile(filepath, payload, 'utf8');
  } catch (error) {
    logger.error({ err: error }, 'failed to write interaction log');
  }
}
