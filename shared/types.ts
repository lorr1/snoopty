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
  | 'file-path-extractor'
  | 'bash-command-processor'
  | 'untagged';

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
  | 'system'              // System prompts
  | 'user'                // User messages (text content)
  | 'assistant'           // Assistant messages (text content)
  | 'thinking'            // Extended thinking content
  | 'tool_mcp'            // MCP tool definitions
  | 'tool_regular'        // Regular tool definitions
  | 'tool_return_mcp'     // MCP tool results/returns
  | 'tool_return_regular' // Regular tool results/returns
  | 'tool_use_mcp'        // MCP tool use blocks
  | 'tool_use_regular';   // Regular tool use blocks

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

export interface ToolCallDetail {
  toolCallId: string;
  toolName: string;
  toolType: 'mcp' | 'regular';
  timestamp: string;
  returnTokens?: number;
}

export interface ToolUsageDetail {
  toolName: string;
  callCount: number;
  totalReturnTokens: number;
  returnTokenCounts: number[];
}

export interface ToolMetricsSummary {
  totalToolsAvailable: number;
  totalToolCalls: number;
  totalToolResults: number;
  tools: ToolUsageDetail[];
  toolCalls: ToolCallDetail[];
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
 * Unique tool call extracted from logs.
 * Each tool call appears once with its metadata and return size.
 */
export interface UniqueToolCall {
  toolCallId: string;
  toolName: string;
  toolType: 'mcp' | 'regular';
  timestamp: string;
  logId: string;
  agentTag?: string;
  model?: string;
  returnTokens?: number;
}

/**
 * Flattened tool usage row for charting.
 * One row per log with token breakdown.
 */
export interface ToolUsageRow {
  logId: string;
  timestamp: string;
  input_system_tokens: number;
  input_user_tokens: number;
  input_assistant_tokens: number;
  input_thinking_tokens: number;
  output_assistant_tokens: number;
  output_thinking_tokens: number;
  agentTag?: string | undefined;
  model?: string | undefined;
  // MCP vs Regular breakdown
  input_tool_definition_mcp_tokens?: number;
  input_tool_definition_regular_tokens?: number;
  input_tool_use_mcp_tokens?: number;
  input_tool_use_regular_tokens?: number;
  input_tool_return_mcp_tokens?: number;
  input_tool_return_regular_tokens?: number;
  output_tool_use_mcp_tokens?: number;
  output_tool_use_regular_tokens?: number;
}

/**
 * Response containing tool call data and metrics.
 */
export interface ToolMetricsDataResponse {
  toolCalls: UniqueToolCall[];
  usage: ToolUsageRow[];
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
