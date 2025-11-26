import { useEffect, useMemo, useState } from 'react';
import type {
  AgentTagInfo,
  InteractionLog,
  LogSummary
} from '../../../shared/types';
import { formatDuration, formatTimestamp, prettifyJson } from '../utils/formatting';
import {
  buildCustomBreakdowns,
  buildTokenChips,
  formatTokenCount,
} from '../utils/tokenHelpers';
import ChatPreviewModal, {
  type ChatPreviewMetadata,
  type ChatPreviewSegment,
} from './ChatPreviewModal';

const DETAIL_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'request', label: 'Request' },
  { id: 'response', label: 'Response' },
  { id: 'raw', label: 'Raw JSON' },
] as const;

type DetailTabId = (typeof DETAIL_TABS)[number]['id'];
type ResponseViewMode = 'body' | 'stream';

const FALLBACK_AGENT_TAG: AgentTagInfo = {
  id: 'untagged',
  label: 'Untagged',
  description: 'No system prompt detected for this request.',
  theme: {
    text: '#0f172a',
    background: 'rgba(15, 23, 42, 0.08)',
    border: 'rgba(15, 23, 42, 0.2)',
  },
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatBody(value: unknown, emptyLabel: string): string {
  const formatted = prettifyJson(value);
  return formatted === '' ? emptyLabel : formatted;
}

function formatRoleLabel(role: string): string {
  if (!role) return 'Message';
  const normalized = role.replace(/_/g, ' ').trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function roleToVariant(role: string): ChatPreviewSegment['variant'] {
  const normalized = role.toLowerCase();
  if (normalized === 'system') return 'system';
  if (normalized === 'user') return 'user';
  if (normalized === 'assistant') return 'assistant';
  if (normalized === 'tool') return 'tool';
  return 'other';
}

function formatRichContent(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
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
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  return prettifyJson(value);
}

function formatToolDefinition(value: unknown): string {
  if (!isPlainRecord(value)) return formatToolPayload(value);

  const summarySections: string[] = [];
  const type =
    typeof value.type === 'string' && value.type.trim().length > 0
      ? value.type.trim()
      : null;
  const description =
    typeof value.description === 'string' && value.description.trim().length > 0
      ? value.description.trim()
      : null;
  const inputSchema = Object.prototype.hasOwnProperty.call(value, 'input_schema')
    ? (value as { input_schema?: unknown }).input_schema
    : undefined;

  const metaLines: string[] = [];
  if (type) metaLines.push(`Type: ${type}`);
  if (metaLines.length > 0) summarySections.push(metaLines.join('\n'));
  if (description) summarySections.push(`\n${description}`);
  if (inputSchema !== undefined) {
    summarySections.push(`Input schema:\n${prettifyJson(inputSchema)}`);
  }

  const extraEntries = Object.entries(value).filter(
    ([key, entryValue]) =>
      entryValue !== undefined &&
      key !== 'name' &&
      key !== 'type' &&
      key !== 'description' &&
      key !== 'input_schema'
  );
  if (extraEntries.length > 0) {
    summarySections.push(`Other fields:\n${prettifyJson(Object.fromEntries(extraEntries))}`);
  }

  if (summarySections.length > 0) return summarySections.join('\n\n');
  return formatToolPayload(value);
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (isPlainRecord(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (isPlainRecord(parsed)) return parsed;
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
  if (direct) return direct;
  if (fallbackRequest && isPlainRecord(fallbackRequest)) {
    const body = coerceRecord((fallbackRequest as { body?: unknown }).body);
    if (body) return body;
  }
  return null;
}

function extractToolDefinitions(source: unknown): unknown[] | null {
  if (!isPlainRecord(source)) return null;
  const directTools = source.tools;
  if (Array.isArray(directTools) && directTools.length > 0) return directTools;
  const nestedBody = coerceRecord((source as { body?: unknown }).body);
  if (nestedBody) {
    const nestedTools = nestedBody.tools;
    if (Array.isArray(nestedTools) && nestedTools.length > 0) return nestedTools;
  }
  return null;
}

function buildChatPreviewSegments(
  payload: unknown,
  fallbackRequest?: unknown
): ChatPreviewSegment[] {
  const basePayload = resolveChatPayload(payload, fallbackRequest);
  if (!basePayload) return [];
  const segments: ChatPreviewSegment[] = [];
  let counter = 0;

  const addSegment = (segment: Omit<ChatPreviewSegment, 'id'>) => {
    if (!segment.body || segment.body.trim().length === 0) return;
    segments.push({ ...segment, id: `segment-${counter++}` });
  };

  if (basePayload.system !== undefined) {
    const body = formatRichContent(basePayload.system);
    addSegment({ role: 'system', title: 'System', body, variant: 'system' });
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
  if (!messages) return segments;

  messages.forEach((message, messageIndex) => {
    if (!isPlainRecord(message)) return;
    const role =
      typeof message.role === 'string' && message.role.length > 0
        ? message.role
        : `message-${messageIndex}`;
    const title = formatRoleLabel(role);
    const variant = roleToVariant(role);
    const subtitle = typeof message.name === 'string' ? message.name : undefined;
    const content = message.content;

    const pushTextSegment = (text: string) => {
      if (!text || text.trim().length === 0) return;
      addSegment({ role, title, subtitle, body: text, variant });
    };

    if (Array.isArray(content)) {
      let textBuffer: string[] = [];
      const flushBuffer = () => {
        if (textBuffer.length === 0) return;
        pushTextSegment(textBuffer.join('\n\n'));
        textBuffer = [];
      };

      content.forEach((entry) => {
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
            const body = thinkingText ?? prettifyJson(entry);
            const thinkingTitle = title.includes('Thinking') ? title : `${title} · Thinking`;
            addSegment({ role, title: thinkingTitle, subtitle, body, variant: 'thinking' });
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

interface DetailsPanelProps {
  selectedLog: InteractionLog | null;
  selectedSummary: LogSummary | null;
  isDetailLoading: boolean;
  detailError: string | null;
}

export default function DetailsPanel({
  selectedLog,
  selectedSummary,
  isDetailLoading,
  detailError,
}: DetailsPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTabId>('overview');
  const [showRequestHeaders, setShowRequestHeaders] = useState(false);
  const [showResponseHeaders, setShowResponseHeaders] = useState(false);
  const [responseViewMode, setResponseViewMode] = useState<ResponseViewMode>('body');
  const [isChatPreviewOpen, setIsChatPreviewOpen] = useState(false);
  const [isTokenSummaryCollapsed, setIsTokenSummaryCollapsed] = useState(false);

  const selectedTokenUsage = useMemo(
    () => selectedLog?.tokenUsage ?? selectedSummary?.tokenUsage ?? null,
    [selectedLog, selectedSummary]
  );

  const selectedSystemChips = useMemo(
    () => buildTokenChips(selectedTokenUsage?.system_totals),
    [selectedTokenUsage?.system_totals]
  );

  const selectedCustomBreakdowns = useMemo(
    () => buildCustomBreakdowns(selectedTokenUsage?.custom),
    [selectedTokenUsage?.custom]
  );

  const chatPreviewSegments = useMemo(
    () => buildChatPreviewSegments(selectedLog?.request.body, selectedLog?.request),
    [selectedLog?.request.body, selectedLog?.request]
  );

  const activeAgentTag = selectedSummary?.agentTag ?? selectedLog?.agentTag ?? null;
  const detailAgentChip = activeAgentTag ?? FALLBACK_AGENT_TAG;

  const chatPreviewMetadata = useMemo<ChatPreviewMetadata | null>(() => {
    if (!selectedLog) return null;
    const requestBody = isPlainRecord(selectedLog.request.body)
      ? selectedLog.request.body
      : null;
    const model =
      (typeof requestBody?.model === 'string' ? requestBody.model : null) ??
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
    const totals = selectedTokenUsage?.system_totals;
    if (!totals) return null;
    const values: Array<number | null | undefined> = [
      totals.inputTokens,
      totals.outputTokens,
      totals.cacheCreationInputTokens,
      totals.cacheReadInputTokens,
    ];
    const numeric = values.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (numeric.length === 0) return null;
    return numeric.reduce((acc, value) => acc + value, 0);
  }, [selectedTokenUsage?.system_totals]);

  const hasStreamChunks = (selectedLog?.response?.streamChunks?.length ?? 0) > 0;
  const responseToggleAvailable = Boolean(selectedLog?.response);

  const responseBodyValue = useMemo(() => {
    if (!selectedLog?.response) return null;
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

  return (
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
              <button
                type="button"
                className="token-summary__toggle"
                onClick={() => setIsTokenSummaryCollapsed((prev) => !prev)}
              >
                <span>Token Counts</span>
                <span
                  className={`detail-card__chevron${
                    !isTokenSummaryCollapsed ? ' detail-card__chevron--open' : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
              {!isTokenSummaryCollapsed && (
                <div className="token-summary__content">
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
                  Cache created {formatTokenCount(selectedTokenUsage.system_totals.cacheCreationInputTokens)} · Cache read{' '}
                  {formatTokenCount(selectedTokenUsage.system_totals.cacheReadInputTokens)}
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
                        <span className="token-summary__io-total">
                          {formatTokenCount(selectedCustomBreakdowns.input.total)}
                        </span>
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
                        <span className="token-summary__io-total">
                          {formatTokenCount(selectedCustomBreakdowns.output.total)}
                        </span>
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
                  <div className="token-summary__empty">
                    Custom estimator did not run for this log.
                  </div>
                )}
              </div>
                </div>
              )}
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
                        <dt>Log ID</dt>
                        <dd style={{ fontFamily: 'monospace', fontSize: '0.9em' }}>{selectedLog.id}</dd>
                      </div>
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
                        <dt>Agent</dt>
                        <dd>
                          <span
                            className="agent-chip agent-chip--inline"
                            style={{
                              color: detailAgentChip.theme.text,
                              backgroundColor: detailAgentChip.theme.background,
                              borderColor: detailAgentChip.theme.border,
                            }}
                            title={detailAgentChip.description ?? detailAgentChip.label}
                          >
                            {detailAgentChip.label}
                          </span>
                        </dd>
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
                    <pre className="details-code details-code--light details-code--collapsible">
                      {prettifyJson(selectedLog.request.headers)}
                    </pre>
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
                    <pre className="details-code details-code--light details-code--expand">
                      {formatBody(selectedLog.request.body, 'No request body captured.')}
                    </pre>
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
                    <pre className="details-code details-code--light details-code--collapsible">
                      {prettifyJson(selectedLog.response?.headers ?? {})}
                    </pre>
                  )}
                </div>
                <div className="detail-card detail-card--grow">
                  <div className="detail-card__header detail-card__header--with-toggle">
                    <span>Response Body</span>
                    {responseToggleAvailable && (
                      <div
                        className="response-view-toggle"
                        role="group"
                        aria-label="Response view mode"
                      >
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
                    <pre className="details-code details-code--light details-code--expand">
                      {prettifyJson(selectedLog)}
                    </pre>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {isChatPreviewOpen && hasChatPreview && (
        <ChatPreviewModal
          isOpen={isChatPreviewOpen}
          onClose={() => setIsChatPreviewOpen(false)}
          segments={chatPreviewSegments}
          metadata={chatPreviewMetadata}
        />
      )}
    </section>
  );
}
