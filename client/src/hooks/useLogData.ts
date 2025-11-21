import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LogSummary } from '../../../shared/types';

export interface LogWithTime extends LogSummary {
  timestampMs: number;
}

function parseTimestampMs(value: string): number {
  const result = Date.parse(value);
  return Number.isNaN(result) ? 0 : result;
}

function areLogsEqual(a: LogSummary[], b: LogSummary[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      return false;
    }
  }
  return true;
}

// =============================================================================
// Constants
// =============================================================================

/** How often to poll for new logs (in milliseconds) */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Number of milliseconds in a day */
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/** Number of logs to fetch */
const FETCH_LIMIT = 1000;

// =============================================================================
// Hook
// =============================================================================

export interface UseLogDataReturn {
  logs: LogSummary[];
  logsWithTime: LogWithTime[];
  earliestTimestampMs: number;
  latestTimestampMs: number;
  listError: string | null;
  isLoading: boolean;
  hasFirstPageLoaded: boolean;
  isRecomputing: boolean;
  recomputeMessage: string | null;
  fetchLogs: (options?: { background?: boolean }) => Promise<void>;
  handleRecompute: () => Promise<void>;
}

export function useLogData(): UseLogDataReturn {
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFirstPageLoaded, setHasFirstPageLoaded] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);

  const logsWithTime = useMemo<LogWithTime[]>(() => {
    const parsed = logs.map((entry) => ({
      ...entry,
      timestampMs: parseTimestampMs(entry.timestamp),
    }));
    // Add tiny offsets for entries that land in the exact same millisecond
    const seenCounts = new Map<number, number>();
    return parsed.map((entry) => {
      const count = seenCounts.get(entry.timestampMs) ?? 0;
      seenCounts.set(entry.timestampMs, count + 1);
      if (count === 0) {
        return entry;
      }
      return {
        ...entry,
        timestampMs: entry.timestampMs + count,
      };
    });
  }, [logs]);

  const earliestTimestampMs = useMemo(() => {
    if (logsWithTime.length === 0) {
      return Date.now() - MILLIS_PER_DAY;
    }
    return logsWithTime.reduce(
      (min, entry) => Math.min(min, entry.timestampMs),
      logsWithTime[0]?.timestampMs ?? Date.now()
    );
  }, [logsWithTime]);

  const latestTimestampMs = useMemo(() => {
    if (logsWithTime.length === 0) {
      return Date.now();
    }
    return logsWithTime.reduce((max, entry) => Math.max(max, entry.timestampMs), Date.now());
  }, [logsWithTime]);

  const fetchLogs = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setIsLoading(true);
    }
    try {
      const response = await fetch(`/api/logs?limit=${FETCH_LIMIT}`);
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.statusText}`);
      }
      const data = (await response.json()) as { items: LogSummary[] };

      setLogs((prev) => {
        if (areLogsEqual(prev, data.items)) {
          return prev;
        }
        return data.items;
      });

      setListError(null);
      setHasFirstPageLoaded(true);
    } catch (error) {
      console.error('[snoopty] fetchLogs error', error);
      setListError(error instanceof Error ? error.message : 'Unknown error while loading logs');
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, []);

  const handleRecompute = useCallback(async () => {
    setIsRecomputing(true);
    setRecomputeMessage(null);
    try {
      const response = await fetch('/api/logs/recompute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Recompute failed: ${response.statusText}`);
      }
      const data = (await response.json()) as {
        processed: number;
        updatedBodies: number;
        updatedUsage: number;
        updatedTags?: number;
        failed: Array<{ fileName: string; error: string }>;
      };
      const summaryParts = [
        `Processed ${data.processed} log${data.processed === 1 ? '' : 's'}`,
        `${data.updatedBodies} body updates`,
        `${data.updatedUsage} usage updates`,
      ];
      if (typeof data.updatedTags === 'number') {
        summaryParts.push(`${data.updatedTags} tag updates`);
      }
      if (data.failed.length > 0) {
        summaryParts.push(`${data.failed.length} failed`);
      }
      setRecomputeMessage(summaryParts.join(' · '));
      await fetchLogs();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during recompute';
      setRecomputeMessage(message);
    } finally {
      setIsRecomputing(false);
    }
  }, [fetchLogs]);

  // Initial fetch
  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Polling
  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchLogs({ background: true });
    }, DEFAULT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchLogs]);

  return {
    logs,
    logsWithTime,
    earliestTimestampMs,
    latestTimestampMs,
    listError,
    isLoading,
    hasFirstPageLoaded,
    isRecomputing,
    recomputeMessage,
    fetchLogs,
    handleRecompute,
  };
}
