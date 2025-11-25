/**
 * Shared type definitions used by both backend and frontend.
 * This is the single source of truth for API types.
 */

// =============================================================================
// Agent Tag Types
// =============================================================================

export type AgentTagId =
  | 'primary'
  | 'file-search'
  | 'topic-labeler'
  | 'framework-detector'
  | 'language-detector'
  | 'conversation-summarizer'
  | 'unknown';

export interface AgentTagTheme {
  text: string;
  background: string;
  border: string;
}

export interface AgentTagInfo {
  id: AgentTagId;
  label: string;
  description?: string;
  theme: AgentTagTheme;
}

// =============================================================================
// Token Usage Types
// =============================================================================

export interface TokenUsageTotals {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
}

export type TokenUsageSegmentId =
  | 'system'
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'tool_return'
  | 'tool_use';

export type TokenMethodology = 'anthropic' | 'estimate' | 'unknown';

export interface TokenCountDetail {
  tokens: number | null;
  textLength: number;
  segments: number;
  methodology: TokenMethodology;
  notes?: string;
}

export interface TokenBreakdown {
  segments: Record<string, TokenCountDetail>;
  totalTokens: number | null;
}

export interface CustomTokenUsage {
  provider: string;
  methodology: TokenMethodology;
  input: TokenBreakdown;
  output: TokenBreakdown;
  totalTokens: number | null;
  errors?: string[];
}

export interface TokenUsageSummary {
  system_totals: TokenUsageTotals;
  custom?: CustomTokenUsage;
}

// =============================================================================
// Tool Metrics Types
// =============================================================================

export interface ToolUsageDetail {
  toolName: string;
  callCount: number;
  totalReturnTokens: number;
  avgReturnTokens: number;
  maxReturnTokens: number;
  minReturnTokens: number | null;
  returnTokenCounts: number[];
}

export interface ToolMetricsSummary {
  totalToolsAvailable: number;
  totalToolCalls: number;
  totalToolResults: number;
  tools: ToolUsageDetail[];
}

// =============================================================================
// Interaction Log Types
// =============================================================================

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
  tokenUsage: TokenUsageSummary;
  agentTag?: AgentTagInfo;
  toolMetrics?: ToolMetricsSummary;
}

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
  agentTag?: AgentTagInfo;
  toolMetrics?: ToolMetricsSummary;
}

// =============================================================================
// Analytics Types
// =============================================================================

/**
 * Filters for querying metrics.
 */
export interface MetricsFilters {
  /** Start timestamp (ISO 8601) */
  startTime?: string;
  /** End timestamp (ISO 8601) */
  endTime?: string;
  /** Filter by agent tag IDs */
  agentTags?: AgentTagId[];
  /** Filter by endpoint type */
  endpointType?: 'messages' | 'other' | 'all';
}

/**
 * Flattened tool result row for charting.
 * One row per individual tool result.
 */
export interface ToolResultRow {
  logId: string;
  timestamp: string;
  toolName: string;
  returnTokens: number;
  agentTag?: string | undefined;
  model?: string | undefined;
}

/**
 * Flattened tool call row for charting.
 * One row per tool per log.
 */
export interface ToolCallRow {
  logId: string;
  timestamp: string;
  toolName: string;
  callCount: number;
  agentTag?: string | undefined;
  model?: string | undefined;
}

/**
 * Response containing filtered tool usage data.
 */
export interface ToolMetricsDataResponse {
  results: ToolResultRow[];
  calls: ToolCallRow[];
  filters: MetricsFilters;
  totalLogs: number;
  logsWithTools: number;
}

// =============================================================================
// API Types
// =============================================================================

export interface ListLogsOptions {
  limit: number;
  cursor?: string;
}

export interface ListLogsResult {
  items: LogSummary[];
  nextCursor?: string;
}
