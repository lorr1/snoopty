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

export type InputSegmentId = 'system' | 'user' | 'tool' | 'tool_return';
export type OutputSegmentId = 'assistant' | 'thinking' | 'tool_use';

export interface TokenUsageSegment {
  id: TokenUsageSegmentId;
  label: string;
  tokens: number | null;
  methodology: TokenMethodology;
}

export type TokenMethodology = 'anthropic' | 'estimate' | 'unknown';

export interface TokenUsageSource {
  type: 'anthropic-usage';
  event: string;
  usage: Record<string, unknown>;
}

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
  totals: TokenUsageTotals;
  segments: TokenUsageSegment[];
  sources: TokenUsageSource[];
  custom?: CustomTokenUsage;
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
  tokenUsage?: TokenUsageSummary;
  agentTag?: AgentTagInfo;
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
