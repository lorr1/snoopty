import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import ChatPreviewModal, {
  type ChatPreviewMetadata,
  type ChatPreviewSegment,
} from './components/ChatPreviewModal';
import TimelineBrush, { type TimeRange } from './components/TimelineBrush';
import { clamp } from './utils/time';

/**
 * Primary React view for Snoopty. The component manages three concerns:
 *  1. Polling `/api/logs` and normalizing the data for the timeline,
 *  2. Maintaining time-range selections (Logfire-style brush) and bulk actions,
  * 3. Rendering the detail pane with token summaries and raw payload inspectors.
 *
 * State variables are grouped by responsibility:
 *  - `logs` and derivatives describe the full dataset,
 *  - `selected*` values describe which row (or rows) the user is inspecting,
 *  - Flags like `isDeleting`/`isExporting` drive loading states for buttons.
 */

interface TokenUsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
}

type TokenUsageSegmentId = 'system' | 'user' | 'assistant' | 'thinking' | 'tool' | 'tool_return' | 'tool_use';

interface TokenUsageSegment {
  id: TokenUsageSegmentId;
  label: string;
  tokens: number | null;
  methodology: 'anthropic' | 'estimate' | 'unknown';
}

interface TokenUsageSource {
  type: 'anthropic-usage';
  event: string;
  usage: Record<string, unknown>;
}

interface TokenCountDetail {
  tokens: number | null;
  textLength: number;
  segments: number;
  methodology: 'anthropic' | 'estimate' | 'unknown';
  notes?: string;
}

interface TokenBreakdown {
  segments: Record<string, TokenCountDetail>;
  totalTokens: number | null;
}

interface CustomTokenUsage {
  provider: string;
  methodology: 'anthropic' | 'estimate' | 'unknown';
  input: TokenBreakdown;
  output: TokenBreakdown;
  totalTokens: number | null;
  errors?: string[];
}

interface TokenUsageSummary {
  totals: TokenUsageTotals;
  segments: TokenUsageSegment[];
  sources: TokenUsageSource[];
  custom?: CustomTokenUsage;
}

interface LogSummary {
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

interface LogWithTime extends LogSummary {
  timestampMs: number;
}

interface InteractionLog {
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
}

type GroupedLogs = Array<{
  key: string;
  label: string;
  items: LogSummary[];
}>;

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
  { id: 'raw', label: 'Raw JSON' },
] as const;

type DetailTabId = (typeof DETAIL_TABS)[number]['id'];

type EndpointCategory = 'messages' | 'other';
type EndpointFilter = 'all' | EndpointCategory;
type ResponseViewMode = 'body' | 'stream';

const ENDPOINT_FILTER_OPTIONS: Array<{ id: EndpointFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'other', label: 'Meta' },
];

const ENDPOINT_STYLES: Record<
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

const DEFAULT_POLL_INTERVAL_MS = 5000;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function formatTimestamp(value: string): string {
  try {
    const date = new Date(value);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
  } catch {
    return value;
  }
}

function formatTimeOfDay(value: string): string {
  try {
    const date = new Date(value);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value;
  }
}

function formatDuration(durationMs?: number): string {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${durationMs.toFixed(0)} ms`;
  }
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function prettifyJson(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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

function formatBody(value: unknown, emptyLabel: string): string {
  const formatted = prettifyJson(value);
  return formatted === '' ? emptyLabel : formatted;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatRoleLabel(role: string): string {
  if (!role) {
    return 'Message';
  }
  const normalized = role.replace(/_/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function roleToVariant(role: string): ChatPreviewSegment['variant'] {
  const normalized = role.toLowerCase();
  if (normalized === 'system') {
    return 'system';
  }
  if (normalized === 'user') {
    return 'user';
  }
  if (normalized === 'assistant') {
    return 'assistant';
  }
  if (normalized === 'tool') {
    return 'tool';
  }
  return 'other';
}

function formatRichContent(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatRichContent(entry))
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n\n');
  }
  if (isPlainRecord(value) && typeof value.text === 'string') {
    return value.text;
  }
  return prettifyJson(value);
}

function formatToolPayload(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return prettifyJson(value);
}

function formatToolDefinition(value: unknown): string {
  if (!isPlainRecord(value)) {
    return formatToolPayload(value);
  }

  const summarySections: string[] = [];
  const name =
    typeof value.name === 'string' && value.name.trim().length > 0 ? value.name.trim() : null;
  const type =
    typeof value.type === 'string' && value.type.trim().length > 0 ? value.type.trim() : null;
  const description =
    typeof value.description === 'string' && value.description.trim().length > 0
      ? value.description.trim()
      : null;
  const inputSchema = Object.prototype.hasOwnProperty.call(value, 'input_schema')
    ? (value as { input_schema?: unknown }).input_schema
    : undefined;

  const metaLines: string[] = [];
  if (type) {
    metaLines.push(`Type: ${type}`);
  }
  if (metaLines.length > 0) {
    summarySections.push(metaLines.join('\n'));
  }

  if (description) {
    summarySections.push(`\n${description}`);
  }

  if (inputSchema !== undefined) {
    summarySections.push(`Input schema:\n${prettifyJson(inputSchema)}`);
  }

  const extraEntries = Object.entries(value).filter(
    ([key, entryValue]) =>
      entryValue !== undefined &&
      key !== 'name' &&
      key !== 'type' &&
      key !== 'description' &&
      key !== 'input_schema',
  );
  if (extraEntries.length > 0) {
    summarySections.push(`Other fields:\n${prettifyJson(Object.fromEntries(extraEntries))}`);
  }

  if (summarySections.length > 0) {
    return summarySections.join('\n\n');
  }
  return formatToolPayload(value);
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (isPlainRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isPlainRecord(parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function resolveChatPayload(
  payload: unknown,
  fallbackRequest?: unknown
): Record<string, unknown> | null {
  const direct = coerceRecord(payload);
  if (direct) {
    return direct;
  }
  if (fallbackRequest && isPlainRecord(fallbackRequest)) {
    const body = coerceRecord((fallbackRequest as { body?: unknown }).body);
    if (body) {
      return body;
    }
  }
  return null;
}

function extractToolDefinitions(source: unknown): unknown[] | null {
  if (!isPlainRecord(source)) {
    return null;
  }
  const directTools = source.tools;
  if (Array.isArray(directTools) && directTools.length > 0) {
    return directTools;
  }
  const nestedBody = coerceRecord((source as { body?: unknown }).body);
  if (nestedBody) {
    const nestedTools = nestedBody.tools;
    if (Array.isArray(nestedTools) && nestedTools.length > 0) {
      return nestedTools;
    }
  }
  return null;
}

function buildChatPreviewSegments(
  payload: unknown,
  fallbackRequest?: unknown
): ChatPreviewSegment[] {
  const basePayload = resolveChatPayload(payload, fallbackRequest);
  if (!basePayload) {
    return [];
  }
  const segments: ChatPreviewSegment[] = [];
  let counter = 0;

  const addSegment = (segment: Omit<ChatPreviewSegment, 'id'>) => {
    if (!segment.body || segment.body.trim().length === 0) {
      return;
    }
    segments.push({ ...segment, id: `segment-${counter++}` });
  };

  if (basePayload.system !== undefined) {
    const body = formatRichContent(basePayload.system);
    addSegment({
      role: 'system',
      title: 'System',
      body,
      variant: 'system',
    });
  }

  const primaryTools = Array.isArray(basePayload.tools) ? basePayload.tools : null;
  const fallbackTools =
    (!primaryTools || primaryTools.length === 0) && fallbackRequest
      ? extractToolDefinitions(fallbackRequest)
      : null;
  const tools = primaryTools && primaryTools.length > 0 ? primaryTools : fallbackTools;
  if (tools && tools.length > 0) {
    tools.forEach((tool, toolIndex) => {
      const toolRecord = isPlainRecord(tool) ? tool : null;
      const name =
        (toolRecord && typeof toolRecord.name === 'string' && toolRecord.name.trim()) ||
        `Tool Definition ${toolIndex + 1}`;
      const subtitle =
        toolRecord && typeof toolRecord.type === 'string' ? toolRecord.type : undefined;
      addSegment({
        role: 'tool.definition',
        title: `Tool Definition · ${name}`,
        subtitle,
        body: formatToolDefinition(tool ?? {}),
        variant: 'tool-definition',
      });
    });
  }

  const messages = Array.isArray(basePayload.messages) ? basePayload.messages : null;
  if (!messages) {
    return segments;
  }

  messages.forEach((message, messageIndex) => {
    if (!isPlainRecord(message)) {
      return;
    }
    const role =
      typeof message.role === 'string' && message.role.length > 0
        ? message.role
        : `message-${messageIndex}`;
    const title = formatRoleLabel(role);
    const variant = roleToVariant(role);
    const subtitle = typeof message.name === 'string' ? message.name : undefined;
    const content = message.content;

    const pushTextSegment = (text: string) => {
      if (!text || text.trim().length === 0) {
        return;
      }
      addSegment({
        role,
        title,
        subtitle,
        body: text,
        variant,
      });
    };

    if (Array.isArray(content)) {
      let textBuffer: string[] = [];
      const flushBuffer = () => {
        if (textBuffer.length === 0) {
          return;
        }
        pushTextSegment(textBuffer.join('\n\n'));
        textBuffer = [];
      };

      content.forEach((entry, entryIndex) => {
        if (isPlainRecord(entry)) {
          const type = typeof entry.type === 'string' ? entry.type : '';
          if ((type === 'text' || type === 'input_text') && typeof entry.text === 'string') {
            textBuffer.push(entry.text);
            return;
          }
          if (type === 'tool_use') {
            flushBuffer();
            const toolSubtitle =
              typeof entry.id === 'string' ? `tool_use_id: ${entry.id}` : undefined;
            addSegment({
              role: 'tool',
              title: entry.name ? `Tool Use · ${entry.name}` : 'Tool Use',
              subtitle: toolSubtitle,
              body: formatToolPayload(entry.input ?? {}),
              variant: 'tool-use',
            });
            return;
          }
          if (type === 'tool_result') {
            flushBuffer();
            const resultSubtitle =
              typeof entry.tool_use_id === 'string'
                ? `tool_use_id: ${entry.tool_use_id}`
                : undefined;
            addSegment({
              role: 'tool',
              title: entry.name ? `Tool Return · ${entry.name}` : 'Tool Return',
              subtitle: resultSubtitle,
              body: formatRichContent(entry.content ?? entry.result ?? entry.text ?? ''),
              variant: 'tool-return',
            });
            return;
          }
          if (type === 'thinking') {
            flushBuffer();
            const thinkingEntry = entry as {
              text?: unknown;
              thinking?: unknown;
              signature?: unknown;
            };
            const thinkingText =
              typeof thinkingEntry.text === 'string'
                ? thinkingEntry.text
                : typeof thinkingEntry.thinking === 'string'
                  ? thinkingEntry.thinking
                  : null;
            const signature =
              typeof thinkingEntry.signature === 'string' ? thinkingEntry.signature : null;
            let body = thinkingText ?? prettifyJson(entry);
            if (signature && thinkingText) {
              body = `${body}`;
            }
            const thinkingTitle = title.includes('Thinking') ? title : `${title} · Thinking`;
            addSegment({
              role,
              title: thinkingTitle,
              subtitle,
              body,
              variant: 'thinking',
            });
            return;
          }
          if (type === 'output_text' && typeof entry.text === 'string') {
            textBuffer.push(entry.text);
            return;
          }
          textBuffer.push(prettifyJson(entry));
          return;
        }
        if (typeof entry === 'string') {
          textBuffer.push(entry);
          return;
        }
        textBuffer.push(prettifyJson(entry));
      });
      flushBuffer();
      return;
    }

    const formatted = formatRichContent(content);
    pushTextSegment(formatted);
  });

  return segments;
}

function parseTimestampMs(value: string): number {
  const result = Date.parse(value);
  return Number.isNaN(result) ? 0 : result;
}

function isTokenValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatTokenCount(value: number | null | undefined): string {
  return isTokenValue(value) ? value.toLocaleString() : '—';
}

interface TokenChip {
  key: string;
  label: string;
  value: string;
}

interface CustomTokenRow {
  key: string;
  label: string;
  value: string;
  detail: string;
  methodology: string;
  variant: string;
}

interface CustomTokenBreakdowns {
  input: {
    rows: CustomTokenRow[];
    total: number | null;
  };
  output: {
    rows: CustomTokenRow[];
    total: number | null;
  };
}

function buildTokenChips(totals?: TokenUsageTotals): TokenChip[] {
  if (!totals) {
    return [];
  }
  const chips: TokenChip[] = [];
  if (isTokenValue(totals.inputTokens)) {
    chips.push({
      key: 'input',
      label: 'In',
      value: formatTokenCount(totals.inputTokens),
    });
  }
  if (isTokenValue(totals.outputTokens)) {
    chips.push({
      key: 'output',
      label: 'Out',
      value: formatTokenCount(totals.outputTokens),
    });
  }
  return chips;
}

function buildCustomBreakdowns(custom?: CustomTokenUsage): CustomTokenBreakdowns | null {
  if (!custom) {
    return null;
  }

  // Check if the custom data has the new input/output structure
  if (!custom.input || !custom.output) {
    // Old data structure - needs recompute
    return null;
  }

  const inputMapping: Array<{ id: string; label: string; variant: string }> = [
    { id: 'system', label: 'System', variant: 'system' },
    { id: 'user', label: 'User', variant: 'user' },
    { id: 'assistant', label: 'Assistant', variant: 'assistant' },
    { id: 'thinking', label: 'Thinking', variant: 'thinking' },
    { id: 'tool', label: 'Tool Definitions', variant: 'tool-definition' },
    { id: 'tool_return', label: 'Tool Returns', variant: 'tool-return' },
    { id: 'tool_use', label: 'Tool Use', variant: 'tool-use' },
  ];

  const outputMapping: Array<{ id: string; label: string; variant: string }> = [
    { id: 'assistant', label: 'Assistant', variant: 'assistant' },
    { id: 'thinking', label: 'Thinking', variant: 'thinking' },
    { id: 'tool_use', label: 'Tool Use', variant: 'tool-use' },
  ];

  const buildRows = (
    segments: Record<string, TokenCountDetail>,
    mapping: Array<{ id: string; label: string; variant: string }>
  ): CustomTokenRow[] => {
    const rows: CustomTokenRow[] = [];
    for (const item of mapping) {
      const detail = segments[item.id];
      if (!detail) {
        continue;
      }
      rows.push({
        key: item.id,
        label: item.label,
        value: formatTokenCount(detail.tokens),
        detail: `${detail.segments} segment${detail.segments === 1 ? '' : 's'}, ${detail.textLength.toLocaleString()} chars`,
        methodology: detail.methodology,
        variant: item.variant,
      });
    }
    return rows;
  };

  return {
    input: {
      rows: buildRows(custom.input.segments, inputMapping),
      total: custom.input.totalTokens,
    },
    output: {
      rows: buildRows(custom.output.segments, outputMapping),
      total: custom.output.totalTokens,
    },
  };
}

function formatRelativeDate(value: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (isSameDay(value, today)) {
    return 'Today';
  }
  if (isSameDay(value, yesterday)) {
    return 'Yesterday';
  }

  return value.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

function groupLogs(items: LogSummary[]): GroupedLogs {
  const groups = new Map<string, { label: string; items: LogSummary[] }>();

  for (const entry of items) {
    const date = new Date(entry.timestamp);
    const key = date.toISOString().slice(0, 10);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(entry);
    } else {
      groups.set(key, {
        label: formatRelativeDate(date),
        items: [entry],
      });
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a > b ? -1 : 1))
    .map(([key, group]) => ({
      key,
      label: group.label,
      items: group.items.sort(
        (left, right) =>
          new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
      ),
    }));
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

function getEndpointCategory(path?: string): EndpointCategory {
  const normalized = path?.toLowerCase() ?? '';
  if (normalized.endsWith('/messages')) {
    return 'messages';
  }
  return 'other';
}

function matchesEndpointFilter(path: string | undefined, filter: EndpointFilter): boolean {
  if (filter === 'all') {
    return true;
  }
  return getEndpointCategory(path) === filter;
}

export default function App(): JSX.Element {
  const [logs, setLogs] = useState<LogSummary[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedLog, setSelectedLog] = useState<InteractionLog | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasFirstPageLoaded, setHasFirstPageLoaded] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingFiltered, setIsDeletingFiltered] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabId>('overview');
  const [showRequestHeaders, setShowRequestHeaders] = useState(false);
  const [showResponseHeaders, setShowResponseHeaders] = useState(false);
  const [timeWindowDays, setTimeWindowDays] = useState(1);
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRange | null>(null);
  const [endpointFilter, setEndpointFilter] = useState<EndpointFilter>('messages');
  const [responseViewMode, setResponseViewMode] = useState<ResponseViewMode>('body');
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [recomputeMessage, setRecomputeMessage] = useState<string | null>(null);
  const [isChatPreviewOpen, setIsChatPreviewOpen] = useState(false);

  const logsWithTime = useMemo<LogWithTime[]>(() => {
    // Parse timestamps once so all downstream calculations (sorting, brush math) can
    // operate on numbers instead of strings.
    const parsed = logs.map((entry) => ({
      ...entry,
      timestampMs: parseTimestampMs(entry.timestamp),
    }));
    // Add tiny offsets for entries that land in the exact same millisecond so the
    // timeline brush can visually separate them even when the original timestamps
    // only have second-level precision.
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

  const latestTimestampMs = useMemo(() => {
    if (logsWithTime.length === 0) {
      return Date.now();
    }
    return logsWithTime.reduce((max, entry) => Math.max(max, entry.timestampMs), Date.now());
  }, [logsWithTime]);

  const windowStartMs = useMemo(
    () => latestTimestampMs - timeWindowDays * MILLIS_PER_DAY,
    [latestTimestampMs, timeWindowDays]
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

  const effectiveSelection = useMemo<TimeRange>(() => {
    if (!selectedTimeRange) {
      return { start: windowStart, end: windowEnd };
    }
    const rawStart = Math.min(selectedTimeRange.start, selectedTimeRange.end);
    const rawEnd = Math.max(selectedTimeRange.start, selectedTimeRange.end);
    const start = clamp(rawStart, windowStart, windowEnd);
    const end = clamp(rawEnd, windowStart, windowEnd);
    if (end - start < 1000) {
      return { start: windowStart, end: windowEnd };
    }
    return { start, end };
  }, [selectedTimeRange, windowStart, windowEnd]);

  const filteredLogs = useMemo(
    () =>
      endpointFilteredLogs.filter(
        (entry) => entry.timestampMs >= effectiveSelection.start && entry.timestampMs <= effectiveSelection.end
      ),
    [endpointFilteredLogs, effectiveSelection]
  );

  const filteredFileNames = useMemo(
    () => filteredLogs.map((entry) => entry.fileName),
    [filteredLogs]
  );

  const brushPoints = useMemo(
    () =>
      windowedLogs.map((entry) => {
        const category = getEndpointCategory(entry.path);
        return {
          timestampMs: entry.timestampMs,
          tone: statusTone(entry.status),
          color: ENDPOINT_STYLES[category].brush,
        };
      }),
    [windowedLogs]
  );

  const selectionActive =
    selectedTimeRange !== null &&
    Math.abs(selectedTimeRange.end - selectedTimeRange.start) >= 1000;

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug('[snoopty] logs fetched', logs.length);
  }, [logs]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug('[snoopty] window', {
      windowStart,
      windowEnd,
      windowedCount: windowedLogs.length,
      timeWindowDays,
    });
  }, [windowStart, windowEnd, windowedLogs.length, timeWindowDays]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug('[snoopty] selection', {
      selectionActive,
      effectiveStart: effectiveSelection.start,
      effectiveEnd: effectiveSelection.end,
      selectedTimeRange,
    });
  }, [selectionActive, effectiveSelection.start, effectiveSelection.end, selectedTimeRange]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug('[snoopty] filtered logs', filteredLogs.length, {
      filteredFileNames,
    });
  }, [filteredLogs.length, filteredFileNames]);

  useEffect(() => {
    setSelectedTimeRange(null);
  }, [timeWindowDays]);

  useEffect(() => {
    setSelectedFiles((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      const visible = new Set(filteredLogs.map((entry) => entry.fileName));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (visible.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [filteredLogs]);

  useEffect(() => {
    if (filteredLogs.length === 0) {
      if (selectedFileName !== null) {
        setSelectedFileName(null);
      }
      return;
    }
    if (!selectedFileName || !filteredLogs.some((entry) => entry.fileName === selectedFileName)) {
      setSelectedFileName(filteredLogs[0].fileName);
    }
  }, [filteredLogs, selectedFileName]);

  const selectedCount = useMemo(() => selectedFiles.size, [selectedFiles]);
  const selectedSummary = useMemo(
    () => filteredLogs.find((entry) => entry.fileName === selectedFileName) ?? null,
    [filteredLogs, selectedFileName]
  );
  const selectedList = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const hasSelection = selectedCount > 0;

  const maxDuration = useMemo(
    () => filteredLogs.reduce((acc, entry) => Math.max(acc, entry.durationMs ?? 0), 0),
    [filteredLogs]
  );

  const groupedLogs = useMemo(() => groupLogs(filteredLogs), [filteredLogs]);

  const selectedTokenUsage = useMemo(
    () => selectedLog?.tokenUsage ?? selectedSummary?.tokenUsage ?? null,
    [selectedLog, selectedSummary]
  );
  const selectedSystemChips = useMemo(
    () => buildTokenChips(selectedTokenUsage?.totals),
    [selectedTokenUsage?.totals]
  );
  const selectedCustomBreakdowns = useMemo(
    () => buildCustomBreakdowns(selectedTokenUsage?.custom),
    [selectedTokenUsage?.custom]
  );

  const chatPreviewSegments = useMemo(
    () => buildChatPreviewSegments(selectedLog?.request.body, selectedLog?.request),
    [selectedLog?.request.body, selectedLog?.request]
  );

  const chatPreviewMetadata = useMemo<ChatPreviewMetadata | null>(() => {
    if (!selectedLog) {
      return null;
    }
    const requestBody = isPlainRecord(selectedLog.request.body)
      ? selectedLog.request.body
      : null;
    const model =
      (typeof requestBody?.model === 'string' && requestBody.model) ??
      selectedSummary?.model ??
      null;
    return {
      model,
      method: selectedLog.method,
      path: selectedLog.path,
      timestamp: formatTimestamp(selectedLog.timestamp),
    };
  }, [selectedLog, selectedSummary?.model]);

  const hasChatPreview = chatPreviewSegments.length > 0;

  const totalUsageTokens = useMemo(() => {
    const totals = selectedTokenUsage?.totals;
    if (!totals) {
      return null;
    }
    const values: Array<number | null | undefined> = [
      totals.inputTokens,
      totals.outputTokens,
      totals.cacheCreationInputTokens,
      totals.cacheReadInputTokens,
    ];
    const numeric = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (numeric.length === 0) {
      return null;
    }
    return numeric.reduce((acc, value) => acc + value, 0);
  }, [selectedTokenUsage?.totals]);

  const hasStreamChunks = (selectedLog?.response?.streamChunks?.length ?? 0) > 0;

  const responseToggleAvailable = Boolean(selectedLog?.response);

  const responseBodyValue = useMemo(() => {
    if (!selectedLog?.response) {
      return null;
    }
    if (responseViewMode === 'stream' && hasStreamChunks) {
      const combined =
        selectedLog.response.streamChunks?.join('')?.replace(/\\n/g, '\n') ?? '';
      return combined;
    }
    const bodyValue =
      selectedLog.response.body ??
      selectedLog.response.streamChunks?.join('') ??
      null;
    return bodyValue;
  }, [selectedLog?.response, responseViewMode, hasStreamChunks]);

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.debug('[snoopty] selection target', {
      selectedFileName,
      selectedSummaryId: selectedSummary?.id ?? null,
      selectedLogId: selectedLog?.id ?? null,
    });
  }, [selectedFileName, selectedSummary?.id, selectedLog?.id]);

  useEffect(() => {
    setShowRequestHeaders(false);
    setShowResponseHeaders(false);
    setIsChatPreviewOpen(false);
    if (!selectedLog) {
      setActiveTab('overview');
      setResponseViewMode('body');
      return;
    }
    if (selectedLog.response?.body) {
      setResponseViewMode('body');
    } else if (selectedLog.response?.streamChunks?.length) {
      setResponseViewMode('stream');
    } else {
      setResponseViewMode('body');
    }
  }, [selectedLog?.id]);

  const toggleSelection = useCallback((fileName: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) {
        next.delete(fileName);
      } else {
        next.add(fileName);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFiles(() => new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedFiles(() => new Set(filteredLogs.map((entry) => entry.fileName)));
  }, [filteredLogs]);

  const handleTimeWindowInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const rawValue = Number.parseInt(event.target.value, 10);
      if (Number.isNaN(rawValue)) {
        return;
      }
      const clampedDays = clamp(rawValue, 1, 30);
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

  const handleBrushSelection = useCallback((range: TimeRange | null) => {
    setSelectedTimeRange(range);
  }, []);

  const handleClearTimeSelection = useCallback(() => {
    setSelectedTimeRange(null);
  }, []);

  const fetchLogs = useCallback(async ({ background = false } = {}) => {
    if (!background) {
      setIsLoading(true);
    }
    try {
      const response = await fetch('/api/logs?limit=1000');
      if (!response.ok) {
        throw new Error(`Failed to load logs: ${response.statusText}`);
      }
      const data = (await response.json()) as { items: LogSummary[] };

      let didUpdate = false;
      setLogs((prev) => {
        if (areLogsEqual(prev, data.items)) {
          return prev;
        }
        didUpdate = true;
        return data.items;
      });

      if (didUpdate) {
        setListError(null);
        setHasFirstPageLoaded(true);
        setSelectedFiles((prev) => {
          if (prev.size === 0) {
            return prev;
          }
          const validNames = new Set(data.items.map((item) => item.fileName));
          let changed = false;
          const next = new Set<string>();
          prev.forEach((name) => {
            if (validNames.has(name)) {
              next.add(name);
            } else {
              changed = true;
            }
          });
          if (!changed && next.size === prev.size) {
            return prev;
          }
          return next;
        });
        if (
          selectedFileName &&
          !data.items.some((item) => item.fileName === selectedFileName)
        ) {
          setSelectedFileName(data.items.length > 0 ? data.items[0].fileName : null);
        } else if (!selectedFileName && data.items.length > 0) {
          setSelectedFileName(data.items[0].fileName);
        }
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[snoopty] fetchLogs error', error);
      setListError(error instanceof Error ? error.message : 'Unknown error while loading logs');
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [selectedFileName]);

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
        failed: Array<{ fileName: string; error: string }>;
      };
      const summaryParts = [
        `Processed ${data.processed} log${data.processed === 1 ? '' : 's'}`,
        `${data.updatedBodies} body updates`,
        `${data.updatedUsage} usage updates`,
      ];
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

  const handleDeleteFiltered = useCallback(async () => {
    if (filteredFileNames.length === 0) {
      return;
    }
    const count = filteredFileNames.length;
    const label =
      count === 1
        ? 'the log that matches your current filters'
        : `${count.toLocaleString()} logs that match your current filters`;
    const confirmed = window.confirm(
      `Delete ${label}? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setExportError(null);
    setIsDeletingFiltered(true);
    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileNames: filteredFileNames }),
      });
      if (!response.ok) {
        throw new Error(`Failed to delete logs: ${response.statusText}`);
      }
      const data = (await response.json()) as {
        deleted: string[];
        failed: Array<{ fileName: string; error: string }>;
      };

      if (data.failed && data.failed.length > 0) {
        const names = data.failed.map((entry) => entry.fileName).join(', ');
        setDeleteError(`Failed to delete ${data.failed.length} entries: ${names}`);
      } else {
        setDeleteError(null);
      }

      setSelectedFiles(() => new Set());
      await fetchLogs();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[snoopty] deleteFiltered error', error);
      setDeleteError(error instanceof Error ? error.message : 'Unknown error deleting logs');
    } finally {
      setIsDeletingFiltered(false);
    }
  }, [filteredFileNames, fetchLogs]);

  const handleExportFiltered = useCallback(async () => {
    if (filteredFileNames.length === 0) {
      return;
    }
    setExportError(null);
    setIsExporting(true);
    try {
      const response = await fetch('/api/logs/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileNames: filteredFileNames }),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        let message = `Failed to export logs: ${response.statusText}`;
        try {
          if (contentType?.includes('application/json')) {
            const data = (await response.json()) as { error?: string };
            if (data?.error) {
              message = data.error;
            }
          } else {
            const text = await response.text();
            if (text) {
              message = text;
            }
          }
        } catch {
          // ignore secondary parsing errors
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition');
      const match = disposition?.match(/filename="(.+?)"/);
      const filename = match ? match[1] : `snoopty-export-${Date.now()}.parquet`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      const missingHeader = response.headers.get('x-snoopty-missing');
      if (missingHeader) {
        try {
          const missing = JSON.parse(missingHeader) as string[];
          if (Array.isArray(missing) && missing.length > 0) {
            setExportError(`Export skipped ${missing.length} missing log(s): ${missing.join(', ')}`);
          }
        } catch {
          // ignore malformed header
        }
      } else {
        setExportError(null);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[snoopty] exportFiltered error', error);
      setExportError(
        error instanceof Error ? error.message : 'Unknown error exporting logs'
      );
    } finally {
      setIsExporting(false);
    }
  }, [filteredFileNames]);

  const fetchLogDetails = useCallback(async (fileName: string) => {
    setIsDetailLoading(true);
    try {
      const response = await fetch(`/api/logs/${encodeURIComponent(fileName)}`);
      if (!response.ok) {
        throw new Error(`Failed to load log details: ${response.statusText}`);
      }
      const data = (await response.json()) as InteractionLog;
      setSelectedLog(data);
      setDetailError(null);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[snoopty] fetchLogDetails error', error);
      setDetailError(error instanceof Error ? error.message : 'Unknown error loading details');
      setSelectedLog(null);
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedList.length === 0) {
      return;
    }
    const count = selectedList.length;
    const label =
      count === 1 ? 'the selected log' : `${count.toLocaleString()} selected logs`;
    const confirmed = window.confirm(
      `Delete ${label}? This action cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setExportError(null);
    setIsDeleting(true);
    try {
      const response = await fetch('/api/logs', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileNames: selectedList }),
      });
      if (!response.ok) {
        throw new Error(`Failed to delete logs: ${response.statusText}`);
      }
      const data = (await response.json()) as {
        deleted: string[];
        failed: Array<{ fileName: string; error: string }>;
      };

      if (data.failed && data.failed.length > 0) {
        const names = data.failed.map((entry) => entry.fileName).join(', ');
        setDeleteError(`Failed to delete ${data.failed.length} entries: ${names}`);
      } else {
        setDeleteError(null);
      }

      setSelectedFiles((prev) => {
        if (prev.size === 0) {
          return prev;
        }
        const next = new Set(prev);
        data.deleted.forEach((fileName) => next.delete(fileName));
        if (next.size === prev.size) {
          return prev;
        }
        return next;
      });

      await fetchLogs();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[snoopty] deleteSelected error', error);
      setDeleteError(error instanceof Error ? error.message : 'Unknown error deleting logs');
    } finally {
      setIsDeleting(false);
    }
  }, [selectedList, fetchLogs]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      fetchLogs({ background: true });
    }, DEFAULT_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [fetchLogs]);

  useEffect(() => {
    if (selectedFileName) {
      fetchLogDetails(selectedFileName);
    } else {
      setSelectedLog(null);
    }
  }, [selectedFileName, fetchLogDetails]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">
          <h1>Snoopty</h1>
          <p className="app-tagline">Anthropic proxy inspector</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => fetchLogs()}
            disabled={isLoading && !hasFirstPageLoaded}
          >
            {(isLoading && !hasFirstPageLoaded) ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleRecompute}
            disabled={isRecomputing}
          >
            {isRecomputing ? 'Recomputing…' : 'Recompute Metadata'}
          </button>
          <span className="header-status">
            {(isLoading && !hasFirstPageLoaded) ? 'Loading logs…' : `Showing ${filteredLogs.length} interactions`}
          </span>
          {recomputeMessage && (
            <span className="header-status header-status--muted">{recomputeMessage}</span>
          )}
        </div>
      </header>
      <main className="app-main">
        <div className="timeseries-header">
            <div className="timeseries-controls">
              <div className="timeseries-controls__left">
                <label className="timeseries-controls__range">
                  Show past
                  <input
                  type="number"
                  min={1}
                  max={30}
                  value={timeWindowDays}
                  onChange={handleTimeWindowInputChange}
                />
                day(s)
              </label>
                <label className="timeseries-controls__endpoint">
                  Endpoint
                  <select value={endpointFilter} onChange={handleEndpointFilterChange}>
                    {ENDPOINT_FILTER_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="text-button"
                  onClick={handleClearTimeSelection}
                  disabled={!selectionActive}
              >
                Clear Selection
              </button>
            </div>
            <div className="timeseries-controls__right">
              <button
                type="button"
                className="danger-button"
                onClick={handleDeleteFiltered}
                disabled={
                  filteredFileNames.length === 0 || isDeletingFiltered || isDeleting
                }
              >
                {isDeletingFiltered ? 'Deleting…' : 'Delete Filtered'}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={handleExportFiltered}
                disabled={filteredFileNames.length === 0 || isExporting}
              >
                {isExporting ? 'Exporting…' : 'Export Parquet'}
              </button>
            </div>
          </div>
          <TimelineBrush
            logs={brushPoints}
            range={windowRange}
            effectiveSelection={effectiveSelection}
            selectionActive={selectionActive}
            onSelectionChange={handleBrushSelection}
          />
        </div>
        <section className="timeline-panel">
          <div className="timeline-banner">No older items in the selected time window.</div>
          <div className="timeline-toolbar">
            <div className="timeline-toolbar__left">
              <button
                type="button"
                className="danger-button"
                onClick={handleDeleteSelected}
                disabled={!hasSelection || isDeleting || isDeletingFiltered}
              >
                {isDeleting ? 'Deleting…' : 'Delete Selected'}
              </button>
              <span className="timeline-selection-count">{selectedCount} selected</span>
            </div>
            <div className="timeline-toolbar__right">
              <button
                type="button"
                className="text-button"
                onClick={selectAll}
                disabled={filteredLogs.length === 0}
              >
                Select All
              </button>
              <button
                type="button"
                className="text-button"
                onClick={clearSelection}
                disabled={!hasSelection}
              >
                Clear
              </button>
            </div>
          </div>
          {(listError || deleteError || exportError) && (
            <div className="panel-messages">
              {listError && <span className="error-text">{listError}</span>}
              {deleteError && <span className="error-text">{deleteError}</span>}
              {exportError && <span className="error-text">{exportError}</span>}
            </div>
          )}
          <div className="timeline-groups">
            {groupedLogs.map((group) => (
              <div className="timeline-group" key={group.key}>
                <div className="timeline-group__label">{group.label}</div>
                <ul className="timeline-group__list">
                  {group.items.map((entry) => {
                    const isActive = entry.fileName === selectedFileName;
                    const isChecked = selectedFiles.has(entry.fileName);
                    const duration = entry.durationMs ?? 0;
                    const percent =
                      maxDuration > 0
                        ? Math.max((duration / maxDuration) * 100, duration > 0 ? 6 : 0)
                        : 0;
                    const tokenChips = buildTokenChips(entry.tokenUsage?.totals);
                    const endpointCategory = getEndpointCategory(entry.path);
                    const endpointTheme = ENDPOINT_STYLES[endpointCategory];
                    const startedAtLabel = formatTimeOfDay(entry.timestamp);
                    const fullStartLabel = formatTimestamp(entry.timestamp);
                    const durationLabel = formatDuration(entry.durationMs);
                    const footerText = entry.error
                      ? entry.error
                      : typeof entry.status === 'number'
                      ? String(entry.status)
                      : '—';
                    const footerTextClass = entry.error
                      ? 'timeline-row__footer-text timeline-row__footer-text--error'
                      : 'timeline-row__footer-text';
                    return (
                      <li
                        key={entry.fileName}
                        className={`timeline-row${isActive ? ' timeline-row--active' : ''}`}
                        onClick={() => setSelectedFileName(entry.fileName)}
                        style={{
                          backgroundColor: endpointTheme.cardBg,
                          borderColor: endpointTheme.cardBorder,
                        }}
                      >
                        <div className="timeline-row__content">
                          <div className="timeline-row__selection">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleSelection(entry.fileName)}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </div>
                          <div className="timeline-row__main">
                            <div className="timeline-row__model">
                              {entry.model ?? 'Unknown model'}
                            </div>
                            {tokenChips.length > 0 && (
                              <div className="timeline-row__tokens">
                                {tokenChips.map((chip) => (
                                  <span
                                    key={chip.key}
                                    className={`timeline-row__token-chip timeline-row__token-chip--${chip.key}`}
                                  >
                                    {chip.label} {chip.value}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="timeline-row__footer">
                          <span
                            className="timeline-row__footer-time"
                            title={fullStartLabel}
                          >
                            {startedAtLabel}
                          </span>
                          <span className="timeline-row__footer-duration">{durationLabel}</span>
                          <div className="timeline-row__duration-track">
                            <div
                              className="timeline-row__duration-bar"
                              style={{ width: `${percent}%` }}
                            />
                          </div>
                          <span className={footerTextClass}>{footerText}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            {groupedLogs.length === 0 && (hasFirstPageLoaded || !isLoading) && (
              <div className="empty-state">No interactions captured yet.</div>
            )}
          </div>
        </section>
        <section className="details-panel">
          <div className="details-header">
            <div>
              <h2>Interaction Details</h2>
              {selectedSummary && (
                <div className="details-subtitle">
                  <span className="details-subtitle__model">
                    {selectedSummary.model ?? 'Unknown model'}
                  </span>
                  {selectedSystemChips.length > 0 && (
                    <div className="details-subtitle__tokens">
                      {selectedSystemChips.map((chip) => (
                        <span
                          key={`header-${chip.key}`}
                          className={`details-token-chip details-token-chip--${chip.key}`}
                        >
                          {chip.label} {chip.value}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            {detailError && <span className="error-text">{detailError}</span>}
          </div>
          {isDetailLoading && <div className="loading-indicator">Loading details…</div>}
          {!isDetailLoading && !selectedLog && (
            <div className="empty-state">Select an interaction to inspect its payload.</div>
          )}
          {!isDetailLoading && selectedLog && (
            <>
              {selectedTokenUsage && (
                <div className="token-summary">
                  <div className="token-summary__section token-summary__section--system">
                    <div className="token-summary__title">System Usage</div>
                    <div className="token-summary__chips">
                      {selectedSystemChips.length > 0 ? (
                        selectedSystemChips.map((chip) => (
                          <span
                            key={chip.key}
                            className={`timeline-row__token-chip timeline-row__token-chip--${chip.key}`}
                          >
                            {chip.label} {chip.value}
                          </span>
                        ))
                      ) : (
                        <span className="token-summary__empty">Not reported by Anthropic</span>
                      )}
                    </div>
                    <div className="token-summary__meta">
                      Cache created {formatTokenCount(selectedTokenUsage.totals.cacheCreationInputTokens)} · Cache read{' '}
                      {formatTokenCount(selectedTokenUsage.totals.cacheReadInputTokens)}
                    </div>
                    {totalUsageTokens !== null && (
                      <div className="token-summary__total">
                        Total (In + Out + Cache Created + Cache Read):{' '}
                        <strong>{formatTokenCount(totalUsageTokens)}</strong>
                      </div>
                    )}
                  </div>
                  <div className="token-summary__section token-summary__section--custom">
                    <div className="token-summary__title">
                      Custom Counts
                      {selectedTokenUsage.custom && (
                        <span className="token-summary__subtitle"></span>
                      )}
                    </div>
                    {selectedCustomBreakdowns ? (
                      <div className="token-summary__io-container">
                        <div className="token-summary__io-section">
                          <div className="token-summary__io-header">
                            <span className="token-summary__io-label">Input</span>
                            <span className="token-summary__io-total">{formatTokenCount(selectedCustomBreakdowns.input.total)}</span>
                          </div>
                          <div className="token-summary__grid">
                            {selectedCustomBreakdowns.input.rows.map((row) => (
                              <div
                                className={`token-summary__row token-summary__row--${row.variant}`}
                                key={row.key}
                              >
                                <span className="token-summary__row-label">{row.label}</span>
                                <span className="token-summary__row-value">{row.value}</span>
                                <span className="token-summary__row-detail">{row.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="token-summary__io-section">
                          <div className="token-summary__io-header">
                            <span className="token-summary__io-label">Output</span>
                            <span className="token-summary__io-total">{formatTokenCount(selectedCustomBreakdowns.output.total)}</span>
                          </div>
                          <div className="token-summary__grid">
                            {selectedCustomBreakdowns.output.rows.map((row) => (
                              <div
                                className={`token-summary__row token-summary__row--${row.variant}`}
                                key={row.key}
                              >
                                <span className="token-summary__row-label">{row.label}</span>
                                <span className="token-summary__row-value">{row.value}</span>
                                <span className="token-summary__row-detail">{row.detail}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                        {selectedTokenUsage.custom && (
                          <div className="token-summary__row token-summary__row--total">
                            <span className="token-summary__row-label">Total</span>
                            <span className="token-summary__row-value">
                              {formatTokenCount(selectedTokenUsage.custom.totalTokens)}
                            </span>
                            <span className="token-summary__row-detail">provider estimate</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="token-summary__empty">Custom estimator did not run for this log.</div>
                    )}
                  </div>
                </div>
              )}
              <nav className="detail-tabs" aria-label="Interaction detail tabs">
                {DETAIL_TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`detail-tab${activeTab === tab.id ? ' detail-tab--active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    {tab.label}
                  </button>
                ))}
              </nav>
              <div className="detail-tabpanel">
                {activeTab === 'overview' && (
                  <div className="detail-grid">
                    <div className="detail-card">
                      <div className="detail-card__header">Summary</div>
                      <div className="detail-card__body">
                        <dl className="detail-properties">
                          <div className="detail-property">
                            <dt>Timestamp</dt>
                            <dd>{formatTimestamp(selectedLog.timestamp)}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Duration</dt>
                            <dd>{formatDuration(selectedLog.durationMs)}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Status</dt>
                            <dd>{selectedLog.response?.status ?? '—'}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Model</dt>
                            <dd>{selectedSummary?.model ?? 'Unknown'}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Query</dt>
                            <dd>{selectedLog.query || '—'}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                    <div className="detail-card">
                      <div className="detail-card__header">Request</div>
                      <div className="detail-card__body">
                        <dl className="detail-properties">
                          <div className="detail-property">
                            <dt>Method</dt>
                            <dd>{selectedLog.method}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Path</dt>
                            <dd>{selectedLog.path}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Headers</dt>
                            <dd>{Object.keys(selectedLog.request.headers).length}</dd>
                          </div>
                          <div className="detail-property">
                            <dt>Has Body</dt>
                            <dd>{selectedLog.request.body ? 'Yes' : 'No'}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                    <div className="detail-card">
                      <div className="detail-card__header">Response</div>
                      <div className="detail-card__body">
                        <dl className="detail-properties">
                          <div className="detail-property">
                            <dt>Headers</dt>
                            <dd>
                              {selectedLog.response
                                ? Object.keys(selectedLog.response.headers).length
                                : 0}
                            </dd>
                          </div>
                          <div className="detail-property">
                            <dt>Body Type</dt>
                            <dd>
                              {selectedLog.response?.streamChunks
                                ? 'Stream'
                                : selectedLog.response?.body
                                ? typeof selectedLog.response.body === 'string'
                                  ? 'Text'
                                  : 'JSON'
                                : '—'}
                            </dd>
                          </div>
                          <div className="detail-property">
                            <dt>Error</dt>
                            <dd>{selectedLog.response?.error ?? '—'}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'request' && (
                  <div className="detail-stack">
                    <div className="detail-card detail-card--collapsible">
                      <button
                        type="button"
                        className="detail-card__toggle"
                        onClick={() => setShowRequestHeaders((prev) => !prev)}
                      >
                        <span>Request Headers</span>
                        <span
                          className={`detail-card__chevron${
                            showRequestHeaders ? ' detail-card__chevron--open' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                      {showRequestHeaders && (
                        <pre className="details-code details-code--light details-code--collapsible">{prettifyJson(selectedLog.request.headers)}</pre>
                      )}
                    </div>
                    <div className="detail-card detail-card--grow">
                      <div className="detail-card__header detail-card__header--with-toggle">
                        <span>Request Body</span>
                        {hasChatPreview && (
                          <button
                            type="button"
                            className="detail-card__action"
                            onClick={() => setIsChatPreviewOpen(true)}
                          >
                            Open chat view
                          </button>
                        )}
                      </div>
                      <div className="detail-card__body detail-card__body--flush">
                        <pre className="details-code details-code--light details-code--expand">{formatBody(selectedLog.request.body, 'No request body captured.')}</pre>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'response' && (
                  <div className="detail-stack">
                    <div className="detail-card detail-card--collapsible">
                      <button
                        type="button"
                        className="detail-card__toggle"
                        onClick={() => setShowResponseHeaders((prev) => !prev)}
                      >
                        <span>Response Headers</span>
                        <span
                          className={`detail-card__chevron${
                            showResponseHeaders ? ' detail-card__chevron--open' : ''
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                      {showResponseHeaders && (
                        <pre className="details-code details-code--light details-code--collapsible">{prettifyJson(selectedLog.response?.headers ?? {})}</pre>
                      )}
                    </div>
                    <div className="detail-card detail-card--grow">
                      <div className="detail-card__header detail-card__header--with-toggle">
                        <span>Response Body</span>
                        {responseToggleAvailable && (
                          <div className="response-view-toggle" role="group" aria-label="Response view mode">
                            <button
                              type="button"
                              className={`response-view-toggle__button${
                                responseViewMode === 'body'
                                  ? ' response-view-toggle__button--active'
                                  : ''
                              }`}
                              onClick={() => setResponseViewMode('body')}
                            >
                              Combined
                            </button>
                            <button
                              type="button"
                              className={`response-view-toggle__button${
                                responseViewMode === 'stream'
                                  ? ' response-view-toggle__button--active'
                                  : ''
                              }`}
                              onClick={() => setResponseViewMode('stream')}
                              disabled={!hasStreamChunks}
                            >
                              Stream
                            </button>
                            {!hasStreamChunks && (
                              <span className="response-view-toggle__hint">No stream recorded</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="detail-card__body detail-card__body--flush">
                        <pre className="details-code details-code--light details-code--expand">
                          {formatBody(
                            responseBodyValue,
                            responseViewMode === 'stream'
                              ? 'No streamed response captured.'
                              : 'No response body captured.'
                          )}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'raw' && (
                  <div className="detail-stack">
                    <div className="detail-card detail-card--grow">
                      <div className="detail-card__header">Raw Interaction Log</div>
                      <div className="detail-card__body detail-card__body--flush">
                        <pre className="details-code details-code--light details-code--expand">{prettifyJson(selectedLog)}</pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
      {isChatPreviewOpen && hasChatPreview && (
        <ChatPreviewModal
          isOpen={isChatPreviewOpen}
          onClose={() => setIsChatPreviewOpen(false)}
          segments={chatPreviewSegments}
          metadata={chatPreviewMetadata}
        />
      )}
    </div>
  );
}
