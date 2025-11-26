/**
 * Shared Color Constants
 *
 * Centralized color definitions for all charts and visualizations.
 * Modify these values to change colors across the entire dashboard.
 */

// ============================================================================
// Token Role Colors (used in TokenBreakdownChart pie charts)
// ============================================================================
export const TOKEN_COLORS = {
  system: '#c31919ff',        // Red
  user: '#0ea5e9',          // Sky blue
  assistant: '#22c55e',     // Green
  thinking: '#f472b6',      // Pink
  tools: '#f97316',         // Orange
  toolsOutput: '#7c3aed',   // Purple
} as const;

// ============================================================================
// Tool Type Colors (used in ToolUsageChart and ToolReturnSizeChart)
// Matches timeline view colors - dark for MCP, light for Regular
// ============================================================================
export const TOOL_TYPE_COLORS = {
  // Tool Definition colors - Amber/tan shades (muted to differentiate from red system)
  toolDefinitionMcp: '#ff8800ff',    // Amber (darker) - for MCP tool definitions
  toolDefinitionRegular: '#fcd34d', // Amber (lighter) - for regular tool definitions

  // Tool Use colors - Purple shades
  toolUseMcp: '#6d28d9',           // Purple (darker) - for MCP tool use
  toolUseRegular: '#c4b5fd',       // Purple (lighter) - for regular tool use

  // Tool Return colors - Cyan shades
  toolReturnMcp: '#174493ff',        // Cyan (darker) - for MCP tool returns
  toolReturnRegular: '#49d5e5ff',    // Cyan (lighter) - for regular tool returns
} as const;

// ============================================================================
// Agent Tag Colors (used in TokenBreakdownChart scatter plot)
// These colors match the backend AgentTagAnalyzer.ts TAG_RULES themes
// ============================================================================
export const AGENT_TAG_COLORS: Record<string, string> = {
  'Topic Labeler': '#a855f7',           // Bright purple
  'Conversation Summarizer': '#8b5cf6', // Bright violet
  'File Search': '#f59e0b',             // Bright amber/orange
  'Framework Detector': '#10b981',      // Bright emerald/green
  'Language Detector': '#06b6d4',       // Bright cyan
  'Primary Agent': '#3b82f6',           // Bright blue
  'Untagged': '#64748b',                // Lighter slate/gray
} as const;

// ============================================================================
// Default/Fallback Colors
// ============================================================================
export const DEFAULT_CHART_COLOR = '#8884d8'; // Default blue
export const DEFAULT_STROKE_COLOR = '#fff';   // White stroke for contrast
