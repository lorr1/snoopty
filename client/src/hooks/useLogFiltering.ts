import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentTagInfo } from '../../../shared/types';
import type { TimeRange } from '../components/TimelineBrush';
import { clamp } from '../utils/time';
import type { LogWithTime } from './useLogData';

// =============================================================================
// Types
// =============================================================================

export type EndpointCategory = 'messages' | 'other';
export type EndpointFilter = 'all' | EndpointCategory;
export type AgentFilter = 'all' | 'untagged' | string;

export interface BrushPoint {
  timestampMs: number;
  tone: 'success' | 'warning' | 'error' | 'unknown';
  color: string;
  fileName: string;
}

// =============================================================================
// Constants
// =============================================================================

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const AUTO_RANGE_PADDING_MS = 30 * 1000;
const MIN_AUTO_RANGE_MS = 90 * 1000;
const MILLIS_PER_SECOND = 1000;
const MAX_FILTER_DAYS = 30;

export const ENDPOINT_FILTER_OPTIONS: Array<{ id: EndpointFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'other', label: 'Meta' },
];

export const ENDPOINT_STYLES: Record<
  EndpointCategory,
  {
    chipBg: string;
    chipText: string;
    border: string;
    brush: string;
    cardBg: string;
    cardBorder: string;
  }
> = {
  messages: {
    chipBg: 'rgba(59, 130, 246, 0.12)',
    chipText: '#1d4ed8',
    border: 'rgba(37, 99, 235, 0.8)',
    brush: 'rgba(59, 130, 246, 0.55)',
    cardBg: 'rgba(59, 130, 246, 0.06)',
    cardBorder: 'rgba(37, 99, 235, 0.3)',
  },
  other: {
    chipBg: 'rgba(249, 115, 22, 0.14)',
    chipText: '#c2410c',
    border: 'rgba(234, 88, 12, 0.8)',
    brush: 'rgba(249, 115, 22, 0.5)',
    cardBg: 'rgba(249, 115, 22, 0.08)',
    cardBorder: 'rgba(234, 88, 12, 0.35)',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

export function getEndpointCategory(path?: string): EndpointCategory {
  const normalized = path?.toLowerCase() ?? '';
  if (normalized.endsWith('/messages')) {
    return 'messages';
  }
  return 'other';
}

function statusTone(status?: number): 'success' | 'warning' | 'error' | 'unknown' {
  if (typeof status !== 'number') {
    return 'unknown';
  }
  if (status >= 200 && status < 300) {
    return 'success';
  }
  if (status >= 400 && status < 500) {
    return 'warning';
  }
  return 'error';
}

function matchesEndpointFilter(path: string | undefined, filter: EndpointFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return getEndpointCategory(path) === filter;
}

function matchesAgentFilter(agentTag: AgentTagInfo | undefined, filter: AgentFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'untagged') {
    return !agentTag;
  }
  return agentTag?.id === filter;
}

// =============================================================================
// Hook
// =============================================================================

export interface UseLogFilteringParams {
  logsWithTime: LogWithTime[];
  earliestTimestampMs: number;
  latestTimestampMs: number;
}

export interface UseLogFilteringReturn {
  // State
  timeWindowDays: number;
  selectedTimeRange: TimeRange | null;
  endpointFilter: EndpointFilter;
  agentFilter: AgentFilter;

  // Computed
  agentFilterOptions: Array<{ id: AgentFilter; label: string }>;
  windowRange: TimeRange;
  filteredLogs: LogWithTime[];
  filteredFileNames: string[];
  brushPoints: BrushPoint[];
  selectionActive: boolean;
  timelineRange: TimeRange;
  effectiveSelection: TimeRange;

  // Callbacks
  handleTimeWindowInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleEndpointFilterChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  handleAgentFilterChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  handleBrushSelection: (range: TimeRange | null) => void;
  handleClearTimeSelection: () => void;
}

export function useLogFiltering({
  logsWithTime,
  earliestTimestampMs,
  latestTimestampMs,
}: UseLogFilteringParams): UseLogFilteringReturn {
  // Load filter state from sessionStorage on mount
  const [timeWindowDays, setTimeWindowDays] = useState(() => {
    const stored = sessionStorage.getItem('snoopty.timeWindowDays');
    return stored ? Number(stored) : 1;
  });
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange | null>(() => {
    const stored = sessionStorage.getItem('snoopty.selectedTimeRange');
    return stored ? JSON.parse(stored) : null;
  });
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>(() => {
    const stored = sessionStorage.getItem('snoopty.endpointFilter');
    return (stored as EndpointFilter) || 'messages';
  });
  const [agentFilter, setAgentFilter] = useState<AgentFilter>(() => {
    const stored = sessionStorage.getItem('snoopty.agentFilter');
    return (stored as AgentFilter) || 'all';
  });

  // Save filter state to sessionStorage whenever it changes
  useEffect(() => {
    sessionStorage.setItem('snoopty.timeWindowDays', String(timeWindowDays));
  }, [timeWindowDays]);

  useEffect(() => {
    sessionStorage.setItem('snoopty.selectedTimeRange', JSON.stringify(selectedTimeRange));
  }, [selectedTimeRange]);

  useEffect(() => {
    sessionStorage.setItem('snoopty.endpointFilter', endpointFilter);
  }, [endpointFilter]);

  useEffect(() => {
    sessionStorage.setItem('snoopty.agentFilter', agentFilter);
  }, [agentFilter]);

  const agentFilterOptions = useMemo<Array<{ id: AgentFilter; label: string }>>(() => {
    const seen = new Map<string, { id: AgentFilter; label: string }>();
    let hasUntagged = false;

    logsWithTime.forEach((entry) => {
      if (entry.agentTag) {
        if (!seen.has(entry.agentTag.id)) {
          seen.set(entry.agentTag.id, {
            id: entry.agentTag.id,
            label: entry.agentTag.label,
          });
        }
      } else {
        hasUntagged = true;
      }
    });

    const sorted = Array.from(seen.values()).sort((a, b) =>
      a.label.localeCompare(b.label)
    );
    const options: Array<{ id: AgentFilter; label: string }> = [
      { id: 'all', label: 'All agents' },
      ...sorted,
    ];
    if (hasUntagged) {
      options.push({ id: 'untagged', label: 'Untagged' });
    }
    return options;
  }, [logsWithTime]);

  const windowStartMs = useMemo(
    () => Math.max(latestTimestampMs - timeWindowDays * MILLIS_PER_DAY, earliestTimestampMs),
    [latestTimestampMs, timeWindowDays, earliestTimestampMs]
  );

  const windowRange = useMemo<TimeRange>(() => {
    const start = Math.min(windowStartMs, latestTimestampMs);
    return {
      start,
      end: latestTimestampMs,
    };
  }, [windowStartMs, latestTimestampMs]);

  const windowStart = windowRange.start;
  const windowEnd = windowRange.end;

  const windowedLogs = useMemo(
    () =>
      logsWithTime.filter(
        (entry) => entry.timestampMs >= windowStart && entry.timestampMs <= windowEnd
      ),
    [logsWithTime, windowStart, windowEnd]
  );

  const endpointFilteredLogs = useMemo(
    () => windowedLogs.filter((entry) => matchesEndpointFilter(entry.path, endpointFilter)),
    [windowedLogs, endpointFilter]
  );

  const agentFilteredLogs = useMemo(
    () => endpointFilteredLogs.filter((entry) => matchesAgentFilter(entry.agentTag, agentFilter)),
    [endpointFilteredLogs, agentFilter]
  );

  const effectiveSelection = useMemo<TimeRange>(() => {
    if (!selectedTimeRange) {
      return { start: windowStart, end: windowEnd };
    }
    const rawStart = Math.min(selectedTimeRange.start, selectedTimeRange.end);
    const rawEnd = Math.max(selectedTimeRange.start, selectedTimeRange.end);
    const start = clamp(rawStart, windowStart, windowEnd);
    const end = clamp(rawEnd, windowStart, windowEnd);
    if (end - start < MILLIS_PER_SECOND) {
      return { start: windowStart, end: windowEnd };
    }
    return { start, end };
  }, [selectedTimeRange, windowStart, windowEnd]);

  const filteredLogs = useMemo(
    () =>
      agentFilteredLogs.filter(
        (entry) =>
          entry.timestampMs >= effectiveSelection.start && entry.timestampMs <= effectiveSelection.end
      ),
    [agentFilteredLogs, effectiveSelection]
  );

  const autoTimelineRange = useMemo<TimeRange>(() => {
    if (filteredLogs.length === 0) {
      return windowRange;
    }
    let minTs = filteredLogs[0]?.timestampMs ?? windowRange.start;
    let maxTs = filteredLogs[0]?.timestampMs ?? windowRange.end;
    for (const entry of filteredLogs) {
      minTs = Math.min(minTs, entry.timestampMs);
      maxTs = Math.max(maxTs, entry.timestampMs);
    }
    if (maxTs - minTs < MIN_AUTO_RANGE_MS) {
      const midpoint = (minTs + maxTs) / 2;
      minTs = midpoint - MIN_AUTO_RANGE_MS / 2;
      maxTs = midpoint + MIN_AUTO_RANGE_MS / 2;
    } else {
      minTs -= AUTO_RANGE_PADDING_MS;
      maxTs += AUTO_RANGE_PADDING_MS;
    }
    const start = Math.max(windowRange.start, minTs);
    const end = Math.min(windowRange.end, maxTs);
    if (end - start < 1) {
      return windowRange;
    }
    return { start, end };
  }, [filteredLogs, windowRange]);

  const filteredFileNames = useMemo(
    () => filteredLogs.map((entry) => entry.fileName),
    [filteredLogs]
  );

  const brushPoints = useMemo(
    () =>
      filteredLogs.map((entry) => {
        const category = getEndpointCategory(entry.path);
        return {
          timestampMs: entry.timestampMs,
          tone: statusTone(entry.status),
          color: ENDPOINT_STYLES[category].brush,
          fileName: entry.fileName,
        };
      }),
    [filteredLogs]
  );

  const selectionActive =
    selectedTimeRange !== null &&
    Math.abs(selectedTimeRange.end - selectedTimeRange.start) >= MILLIS_PER_SECOND;

  const timelineRange = useMemo<TimeRange>(
    () => (selectionActive ? effectiveSelection : autoTimelineRange),
    [selectionActive, effectiveSelection, autoTimelineRange]
  );

  // Track if this is the first render to avoid resetting on mount
  const isFirstRender = useRef(true);

  // Reset time selection on window change (but not on initial mount)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // User changed the time window, clear the brush selection
    setSelectedTimeRange(null);
  }, [timeWindowDays]);

  // Reset agent filter when option disappears (only after initial load)
  useEffect(() => {
    if (agentFilter === 'all') {
      return;
    }
    // Only reset if we have logs loaded AND the filter doesn't exist
    if (logsWithTime.length > 0 && !agentFilterOptions.some((option) => option.id === agentFilter)) {
      setAgentFilter('all');
      sessionStorage.setItem('snoopty.agentFilter', 'all');
    }
  }, [agentFilter, agentFilterOptions, logsWithTime.length]);

  const handleTimeWindowInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const rawValue = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(rawValue)) {
        return;
      }
      const clampedDays = clamp(rawValue, 1, MAX_FILTER_DAYS);
      setTimeWindowDays(Math.round(clampedDays));
    },
    []
  );

  const handleEndpointFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setEndpointFilter(event.target.value as EndpointFilter);
    },
    []
  );

  const handleAgentFilterChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      setAgentFilter(event.target.value as AgentFilter);
    },
    []
  );

  const handleBrushSelection = useCallback((range: TimeRange | null) => {
    setSelectedTimeRange(range);
  }, []);

  const handleClearTimeSelection = useCallback(() => {
    setSelectedTimeRange(null);
  }, []);

  return {
    timeWindowDays,
    selectedTimeRange,
    endpointFilter,
    agentFilter,
    agentFilterOptions,
    windowRange,
    filteredLogs,
    filteredFileNames,
    brushPoints,
    selectionActive,
    timelineRange,
    effectiveSelection,
    handleTimeWindowInputChange,
    handleEndpointFilterChange,
    handleAgentFilterChange,
    handleBrushSelection,
    handleClearTimeSelection,
  };
}
