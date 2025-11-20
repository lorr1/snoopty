import type { InteractionLog } from './logWriter';
import { analyzeTokenUsage } from './tokenMetrics';

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
  const customToolColumn: ParquetColumn = {
    name: 'custom_tool_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolReturnColumn: ParquetColumn = {
    name: 'custom_tool_return_tokens',
    data: [],
    type: 'DOUBLE',
  };
  const customToolUseColumn: ParquetColumn = {
    name: 'custom_tool_use_tokens',
    data: [],
    type: 'DOUBLE',
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
    customToolColumn,
    customToolReturnColumn,
    customToolUseColumn,
  ];

  for (const { fileName, entry } of records) {
    const usage = await analyzeTokenUsage(entry);
    const totals = usage?.totals;
    const customInput = usage?.custom?.input?.segments;
    const customOutput = usage?.custom?.output?.segments;
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
    // Combine input (history) and output tokens for assistant, thinking, tool_use
    const assistantTotal = (customInput?.assistant?.tokens ?? 0) + (customOutput?.assistant?.tokens ?? 0);
    const thinkingTotal = (customInput?.thinking?.tokens ?? 0) + (customOutput?.thinking?.tokens ?? 0);
    const toolUseTotal = (customInput?.tool_use?.tokens ?? 0) + (customOutput?.tool_use?.tokens ?? 0);
    customAssistantColumn.data.push(assistantTotal || null);
    customThinkingColumn.data.push(thinkingTotal || null);
    customToolColumn.data.push(customInput?.tool?.tokens ?? null);
    customToolReturnColumn.data.push(customInput?.tool_return?.tokens ?? null);
    customToolUseColumn.data.push(toolUseTotal || null);
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
