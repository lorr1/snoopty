/**
 * Token usage helper functions for the Snoopty UI.
 */

import type {
  CustomTokenUsage,
  TokenCountDetail,
  TokenUsageTotals,
} from '../../../shared/types';

export interface TokenChip {
  key: string;
  label: string;
  value: string;
}

export interface CustomTokenRow {
  key: string;
  label: string;
  value: string;
  detail: string;
  methodology: string;
  variant: string;
}

export interface CustomTokenBreakdowns {
  input: {
    rows: CustomTokenRow[];
    total: number | null;
  };
  output: {
    rows: CustomTokenRow[];
    total: number | null;
  };
}

function isTokenValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function formatTokenCount(value: number | null | undefined): string {
  return isTokenValue(value) ? value.toLocaleString() : '—';
}

export function buildTokenChips(totals?: TokenUsageTotals): TokenChip[] {
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

export function buildCustomBreakdowns(custom?: CustomTokenUsage): CustomTokenBreakdowns | null {
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
