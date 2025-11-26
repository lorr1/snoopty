import type { InteractionLog } from './logWriter';

/**
 * Build Parquet columnar data from the on-disk interaction logs. Each log becomes
 * one row in the resulting Parquet file. We intentionally keep the schema very
 * flat (all JSON payloads are stringified) so downstream tools can ingest the file
 * without knowing Snoopty's internal TypeScript types.
 */

interface ParquetColumn {
  name: string;
  data: Array<string | number | null>;
  type?: string;
}

export interface ParquetRecord {
  fileName: string;
  entry: InteractionLog;
}

function safeString(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function collectColumns(records: ParquetRecord[]): Promise<ParquetColumn[]> {
  const fileNameColumn: ParquetColumn = { name: 'file_name', data: [], type: 'STRING' };
  const timestampColumn: ParquetColumn = {
    name: 'timestamp_iso',
    data: [],
    type: 'STRING',
  };
  const methodColumn: ParquetColumn = { name: 'method', data: [], type: 'STRING' };
  const pathColumn: ParquetColumn = { name: 'path', data: [], type: 'STRING' };
  const statusColumn: ParquetColumn = { name: 'status_code', data: [], type: 'INT32' };
  const durationColumn: ParquetColumn = { name: 'duration_ms', data: [], type: 'INT32' };
  const modelColumn: ParquetColumn = { name: 'model', data: [], type: 'STRING' };
  const queryColumn: ParquetColumn = { name: 'query', data: [], type: 'STRING' };
  const requestHeadersColumn: ParquetColumn = {
    name: 'request_headers_json',
    data: [],
    type: 'STRING',
  };
  const requestBodyColumn: ParquetColumn = {
    name: 'request_body_json',
    data: [],
    type: 'STRING',
  };
  const responseHeadersColumn: ParquetColumn = {
    name: 'response_headers_json',
    data: [],
    type: 'STRING',
  };
  const responseBodyColumn: ParquetColumn = {
    name: 'response_body_json',
    data: [],
    type: 'STRING',
  };
  const responseErrorColumn: ParquetColumn = {
    name: 'response_error',
    data: [],
    type: 'STRING',
  };
  const inputTokensColumn: ParquetColumn = {
    name: 'input_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const outputTokensColumn: ParquetColumn = {
    name: 'output_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const cacheCreationColumn: ParquetColumn = {
    name: 'cache_creation_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const cacheReadColumn: ParquetColumn = {
    name: 'cache_read_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customSystemColumn: ParquetColumn = {
    name: 'custom_system_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customUserColumn: ParquetColumn = {
    name: 'custom_user_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customAssistantColumn: ParquetColumn = {
    name: 'custom_assistant_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customThinkingColumn: ParquetColumn = {
    name: 'custom_thinking_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolMcpColumn: ParquetColumn = {
    name: 'custom_tool_mcp_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolRegularColumn: ParquetColumn = {
    name: 'custom_tool_regular_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolReturnMcpColumn: ParquetColumn = {
    name: 'custom_tool_return_mcp_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolReturnRegularColumn: ParquetColumn = {
    name: 'custom_tool_return_regular_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolUseMcpColumn: ParquetColumn = {
    name: 'custom_tool_use_mcp_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolUseRegularColumn: ParquetColumn = {
    name: 'custom_tool_use_regular_tokens',
    data: [],
    type: 'DOUBLE',
  };

  // Tool metrics columns
  const toolMetricsAvailableColumn: ParquetColumn = {
    name: 'tools_available',
    data: [],
    type: 'INT32',
  };
  const toolMetricsCallsColumn: ParquetColumn = {
    name: 'tool_calls',
    data: [],
    type: 'INT32',
  };
  const toolMetricsResultsColumn: ParquetColumn = {
    name: 'tool_results',
    data: [],
    type: 'INT32',
  };
  const toolMetricsJsonColumn: ParquetColumn = {
    name: 'tool_metrics_json',
    data: [],
    type: 'STRING',
  };

  // Agent tag columns
  const agentTagIdColumn: ParquetColumn = {
    name: 'agent_tag_id',
    data: [],
    type: 'STRING',
  };
  const agentTagLabelColumn: ParquetColumn = {
    name: 'agent_tag_label',
    data: [],
    type: 'STRING',
  };
  const agentTagDescriptionColumn: ParquetColumn = {
    name: 'agent_tag_description',
    data: [],
    type: 'STRING',
  };
  const agentTagThemeJsonColumn: ParquetColumn = {
    name: 'agent_tag_theme_json',
    data: [],
    type: 'STRING',
  };

  const columns: ParquetColumn[] = [
    fileNameColumn,
    timestampColumn,
    methodColumn,
    pathColumn,
    statusColumn,
    durationColumn,
    modelColumn,
    queryColumn,
    requestHeadersColumn,
    requestBodyColumn,
    responseHeadersColumn,
    responseBodyColumn,
    responseErrorColumn,
    inputTokensColumn,
    outputTokensColumn,
    cacheCreationColumn,
    cacheReadColumn,
    customSystemColumn,
    customUserColumn,
    customAssistantColumn,
    customThinkingColumn,
    customToolMcpColumn,
    customToolRegularColumn,
    customToolReturnMcpColumn,
    customToolReturnRegularColumn,
    customToolUseMcpColumn,
    customToolUseRegularColumn,
    toolMetricsAvailableColumn,
    toolMetricsCallsColumn,
    toolMetricsResultsColumn,
    toolMetricsJsonColumn,
    agentTagIdColumn,
    agentTagLabelColumn,
    agentTagDescriptionColumn,
    agentTagThemeJsonColumn,
  ];

  for (const { fileName, entry } of records) {
    // Token usage is now stored directly on the entry by MetricsWorker
    const totals = entry.tokenUsage.system_totals;
    const customInput = entry.tokenUsage.custom?.input?.segments;
    const customOutput = entry.tokenUsage.custom?.output?.segments;
    let modelString: string | null = null;
    if (
      entry.request.body &&
      typeof entry.request.body === 'object' &&
      'model' in (entry.request.body as Record<string, unknown>)
    ) {
      const value = (entry.request.body as Record<string, unknown>).model;
      modelString = typeof value === 'string' ? value : safeString(value);
    }
    fileNameColumn.data.push(fileName);
    timestampColumn.data.push(entry.timestamp);
    methodColumn.data.push(entry.method);
    pathColumn.data.push(entry.path);
    statusColumn.data.push(
      typeof entry.response?.status === 'number' ? entry.response.status : null
    );
    durationColumn.data.push(
      typeof entry.durationMs === 'number' ? entry.durationMs : null
    );
    modelColumn.data.push(modelString);
    queryColumn.data.push(entry.query ?? null);
    requestHeadersColumn.data.push(safeString(entry.request.headers));
    requestBodyColumn.data.push(safeString(entry.request.body));
    responseHeadersColumn.data.push(safeString(entry.response?.headers));
    const responseBody =
      typeof entry.response?.body !== 'undefined'
        ? entry.response?.body
        : entry.response?.streamChunks
        ? entry.response.streamChunks
        : null;
    responseBodyColumn.data.push(safeString(responseBody));
    responseErrorColumn.data.push(entry.response?.error ?? null);

    inputTokensColumn.data.push(totals?.inputTokens ?? null);
    outputTokensColumn.data.push(totals?.outputTokens ?? null);
    cacheCreationColumn.data.push(totals?.cacheCreationInputTokens ?? null);
    cacheReadColumn.data.push(totals?.cacheReadInputTokens ?? null);

    customSystemColumn.data.push(customInput?.system?.tokens ?? null);
    customUserColumn.data.push(customInput?.user?.tokens ?? null);
    // Combine input (history) and output tokens for assistant, thinking
    const assistantTotal = (customInput?.assistant?.tokens ?? 0) + (customOutput?.assistant?.tokens ?? 0);
    const thinkingTotal = (customInput?.thinking?.tokens ?? 0) + (customOutput?.thinking?.tokens ?? 0);
    customAssistantColumn.data.push(assistantTotal || null);
    customThinkingColumn.data.push(thinkingTotal || null);

    // Tool-related tokens split by MCP vs Regular
    customToolMcpColumn.data.push(customInput?.tool_mcp?.tokens ?? null);
    customToolRegularColumn.data.push(customInput?.tool_regular?.tokens ?? null);
    customToolReturnMcpColumn.data.push(customInput?.tool_return_mcp?.tokens ?? null);
    customToolReturnRegularColumn.data.push(customInput?.tool_return_regular?.tokens ?? null);

    // Combine input and output tool_use tokens, split by MCP vs Regular
    const toolUseMcpTotal = (customInput?.tool_use_mcp?.tokens ?? 0) + (customOutput?.tool_use_mcp?.tokens ?? 0);
    const toolUseRegularTotal = (customInput?.tool_use_regular?.tokens ?? 0) + (customOutput?.tool_use_regular?.tokens ?? 0);
    customToolUseMcpColumn.data.push(toolUseMcpTotal || null);
    customToolUseRegularColumn.data.push(toolUseRegularTotal || null);

    // Tool metrics
    const toolMetrics = entry.toolMetrics;
    toolMetricsAvailableColumn.data.push(toolMetrics?.totalToolsAvailable ?? null);
    toolMetricsCallsColumn.data.push(toolMetrics?.totalToolCalls ?? null);
    toolMetricsResultsColumn.data.push(toolMetrics?.totalToolResults ?? null);
    toolMetricsJsonColumn.data.push(toolMetrics ? safeString(toolMetrics) : null);

    // Agent tag
    const agentTag = entry.agentTag;
    agentTagIdColumn.data.push(agentTag?.id ?? null);
    agentTagLabelColumn.data.push(agentTag?.label ?? null);
    agentTagDescriptionColumn.data.push(agentTag?.description ?? null);
    agentTagThemeJsonColumn.data.push(agentTag?.theme ? safeString(agentTag.theme) : null);
  }

  return columns;
}

export async function createParquetBuffer(
  records: ParquetRecord[]
): Promise<ArrayBuffer> {
  if (records.length === 0) {
    throw new Error('No logs available to export.');
  }

  // hyparquet-writer works with simple column arrays; all heavy lifting (schema inference,
  // compression, footer metadata) happens inside the library.
  const columnData = await collectColumns(records);
  const module = await import('hyparquet-writer');
  const { parquetWriteBuffer } = module;
  return parquetWriteBuffer({ columnData });
}
