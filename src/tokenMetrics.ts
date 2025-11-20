import type {
  InteractionLog,
  TokenUsageSegment,
  TokenUsageSource,
  TokenUsageSummary,
  TokenUsageTotals,
} from './logWriter';
import { computeCustomTokenUsage } from './tokenCounting';

/**
 * Anthropic responses include token accounting in several places: the JSON body,
 * stream delta messages, and sometimes nested under "message.usage". This helper
 * normalizes that information into the `TokenUsageSummary` shape that the UI and
 * Parquet exporter expect.
 *
 * We aggregate two flavours of data:
 *  - Raw values reported by Anthropic (input/output/cache tokens),
 *  - Custom per-role estimates (system/user/assistant/tool/cache) computed locally.
 */

type UsageRecord = Record<string, unknown>;

const INITIAL_TOTALS: TokenUsageTotals = {
  inputTokens: null,
  outputTokens: null,
  cacheCreationInputTokens: null,
  cacheReadInputTokens: null,
};

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isUsageRecord(value: unknown): value is UsageRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as UsageRecord;
  return (
    toNumber(record.input_tokens) !== null ||
    toNumber(record.output_tokens) !== null ||
    toNumber(record.cache_creation_input_tokens) !== null ||
    toNumber(record.cache_read_input_tokens) !== null ||
    (typeof record.cache_creation === 'object' && record.cache_creation !== null) ||
    (typeof record.cache_read === 'object' && record.cache_read !== null)
  );
}

function extractUsageRecord(value: unknown): UsageRecord | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (isUsageRecord(value)) {
    return value;
  }
  const record = value as UsageRecord;
  if ('usage' in record) {
    return extractUsageRecord(record.usage);
  }
  return null;
}

function sumNestedNumbers(source: unknown): number | null {
  if (typeof source !== 'object' || source === null) {
    return null;
  }
  let total = 0;
  let seen = false;
  for (const value of Object.values(source as UsageRecord)) {
    const num = toNumber(value);
    if (num !== null) {
      total += num;
      seen = true;
    }
  }
  return seen ? total : null;
}

function mergeTotals(target: TokenUsageTotals, usage: UsageRecord): void {
  const inputTokens = toNumber(usage.input_tokens);
  if (inputTokens !== null) {
    target.inputTokens = inputTokens;
  }

  const outputTokens = toNumber(usage.output_tokens);
  if (outputTokens !== null) {
    target.outputTokens = outputTokens;
  }

  const cacheCreation = toNumber(usage.cache_creation_input_tokens);
  if (cacheCreation !== null) {
    target.cacheCreationInputTokens = cacheCreation;
  }

  const cacheRead = toNumber(usage.cache_read_input_tokens);
  if (cacheRead !== null) {
    target.cacheReadInputTokens = cacheRead;
  }

  const nestedCreation = sumNestedNumbers(usage.cache_creation);
  if (nestedCreation !== null) {
    target.cacheCreationInputTokens =
      (target.cacheCreationInputTokens ?? 0) >= nestedCreation
        ? target.cacheCreationInputTokens
        : nestedCreation;
  }

  const nestedRead = sumNestedNumbers(usage.cache_read);
  if (nestedRead !== null) {
    target.cacheReadInputTokens =
      (target.cacheReadInputTokens ?? 0) >= nestedRead ? target.cacheReadInputTokens : nestedRead;
  }
}

class TokenUsageAccumulator {
  private totals: TokenUsageTotals = { ...INITIAL_TOTALS };
  private sources: TokenUsageSource[] = [];

  add(event: string, usage: UsageRecord, options?: { merge?: boolean }): void {
    const shouldMerge = options?.merge ?? true;
    if (shouldMerge) {
      mergeTotals(this.totals, usage);
    }
    this.sources.push({
      type: 'anthropic-usage',
      event,
      usage,
    });
  }

  hasData(): boolean {
    return (
      this.sources.length > 0 ||
      this.totals.inputTokens !== null ||
      this.totals.outputTokens !== null ||
      this.totals.cacheCreationInputTokens !== null ||
      this.totals.cacheReadInputTokens !== null
    );
  }

  async summary(entry: InteractionLog): Promise<TokenUsageSummary> {
    const summary: TokenUsageSummary = {
      totals: this.totals,
      segments: [] as TokenUsageSegment[],
      sources: this.sources,
    };

    const custom = await computeCustomTokenUsage(entry);
    if (custom) {
      summary.custom = custom;
    }

    return summary;
  }
}

function collectUsageFromResponseBody(
  accumulator: TokenUsageAccumulator,
  body: unknown
): void {
  const usage = extractUsageRecord(body);
  if (usage) {
    accumulator.add('response-body', usage);
  }
}

function collectUsageFromStream(
  accumulator: TokenUsageAccumulator,
  chunks: string[],
  entryId?: string
): void {
  // Streamed responses arrive as text/event-stream chunks. We look for `data:` lines,
  // parse each chunk as JSON, and extract any nested usage payloads.
  const usageEvents: Array<{ event: string; usage: UsageRecord }> = [];
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload) {
        continue;
      }
      try {
        const parsed = JSON.parse(payload) as UsageRecord;
        if ('message' in parsed) {
          const messageUsage = extractUsageRecord((parsed as { message: unknown }).message);
          if (messageUsage) {
            usageEvents.push({
              event: `stream:${String(parsed.type ?? 'message')}:message`,
              usage: messageUsage,
            });
            continue;
          }
        }
        const directUsage = extractUsageRecord(parsed);
        if (directUsage) {
          usageEvents.push({
            event: `stream:${String(parsed.type ?? 'unknown')}`,
            usage: directUsage,
          });
        }
      } catch {
        // ignore malformed entries; they are preserved in sources via streamChunks
      }
    }
  }

  if (usageEvents.length === 0) {
    return;
  }

  for (let index = 1; index < usageEvents.length; index += 1) {
    const previous = usageEvents[index - 1]!;
    const current = usageEvents[index]!;
    if (!isNonDecreasingUsage(previous.usage, current.usage)) {
      throw new Error(
        `[tokenMetrics] Stream usage values regressed for entry ${entryId ?? '<unknown>'} ` +
          `between ${previous.event} and ${current.event}`
      );
    }
  }

  usageEvents.forEach((entry, index) => {
    accumulator.add(entry.event, entry.usage, { merge: index === usageEvents.length - 1 });
  });
}

const STREAM_TOTAL_KEYS = [
  'input_tokens',
  'output_tokens',
  'cache_creation_input_tokens',
  'cache_read_input_tokens',
] as const;

function isNonDecreasingUsage(previous: UsageRecord, current: UsageRecord): boolean {
  return STREAM_TOTAL_KEYS.every((key) => {
    const prevValue = toNumber(previous[key]);
    const nextValue = toNumber(current[key]);
    if (prevValue === null || nextValue === null) {
      return true;
    }
    return nextValue >= prevValue;
  });
}

export async function analyzeTokenUsage(
  entry: InteractionLog
): Promise<TokenUsageSummary | undefined> {
  // If we already have token usage recorded, return it directly.
  if (entry.tokenUsage) {
    return entry.tokenUsage;
  }

  if (!entry.response) {
    return undefined;
  }

  const accumulator = new TokenUsageAccumulator();

  if (entry.response.body) {
    collectUsageFromResponseBody(accumulator, entry.response.body);
  }

  if (Array.isArray(entry.response.streamChunks) && entry.response.streamChunks.length > 0) {
    collectUsageFromStream(accumulator, entry.response.streamChunks, entry.id);
  }

  if (!accumulator.hasData()) {
    const custom = await computeCustomTokenUsage(entry);
    if (!custom) {
      return undefined;
    }
    return {
      totals: { ...INITIAL_TOTALS },
      segments: [] as TokenUsageSegment[],
      sources: [],
      custom,
    };
  }

  return accumulator.summary(entry);
}

export async function ensureTokenUsage(
  entry: InteractionLog
): Promise<TokenUsageSummary | undefined> {
  const usage = await analyzeTokenUsage(entry);
  if (usage) {
    entry.tokenUsage = usage;
  }
  return usage;
}
