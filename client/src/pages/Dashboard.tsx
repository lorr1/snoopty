/**
 * Dashboard Page
 *
 * Displays aggregate metrics and visualizations for tool usage.
 * Fetches full InteractionLogs and aggregates client-side.
 * Uses Recharts for all visualizations.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type {
  InteractionLog,
  ToolMetricsDataResponse,
  ToolUsageRow,
  UniqueToolCall,
} from '../../../shared/types';
import TokenBreakdownChart from '../components/charts/TokenBreakdownChart';
import ToolReturnSizeChart from '../components/charts/ToolReturnSizeChart';
import ToolUsageChart from '../components/charts/ToolUsageChart';

/**
 * Extract unique tool calls from InteractionLogs using backend-computed tool metrics.
 * The backend already extracts tool call IDs and computes accurate token counts.
 */
function extractUniqueToolCalls(logs: InteractionLog[]): UniqueToolCall[] {
  const toolCallMap = new Map<string, UniqueToolCall>();

  for (const log of logs) {
    const body = log.request.body as { model?: string } | undefined;
    const model = body?.model;
    const agentTagLabel = log.agentTag?.label;

    // Use backend-computed tool call details if available
    if (log.toolMetrics?.toolCalls) {
      for (const toolCall of log.toolMetrics.toolCalls) {
        // Only add if we haven't seen this tool call ID before (dedup across logs)
        if (!toolCallMap.has(toolCall.toolCallId)) {
          toolCallMap.set(toolCall.toolCallId, {
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            toolType: toolCall.toolType,
            timestamp: toolCall.timestamp,
            logId: log.id,
            agentTag: agentTagLabel,
            model,
            returnTokens: toolCall.returnTokens,
          });
        }
      }
    }
  }

  const result = Array.from(toolCallMap.values());
  return result;
}

/**
 * Aggregate metrics from InteractionLogs client-side.
 * Extracts unique tool calls and token usage.
 */
function aggregateMetrics(logs: InteractionLog[]): ToolMetricsDataResponse {
  const toolCalls = extractUniqueToolCalls(logs);

  // Token usage per log
  const usage: ToolUsageRow[] = [];
  for (const log of logs) {
    const { tokenUsage, agentTag, request, timestamp, id } = log;
    if (!tokenUsage) continue;

    const body = request.body as { model?: string } | undefined;
    const model = body?.model;
    const agentTagLabel = agentTag?.label;

    usage.push({
      logId: id,
      timestamp,
      input_system_tokens: tokenUsage.custom?.input.segments['system']?.tokens || 0,
      input_user_tokens: tokenUsage.custom?.input.segments['user']?.tokens || 0,
      input_assistant_tokens: tokenUsage.custom?.input.segments['assistant']?.tokens || 0,
      input_thinking_tokens: tokenUsage.custom?.input.segments['thinking']?.tokens || 0,
      output_assistant_tokens: tokenUsage.custom?.output.segments['assistant']?.tokens || 0,
      output_thinking_tokens: tokenUsage.custom?.output.segments['thinking']?.tokens || 0,
      agentTag: agentTagLabel,
      model,
      // MCP vs Regular breakdown
      input_tool_definition_mcp_tokens: tokenUsage.custom?.input.segments['tool_mcp']?.tokens || 0,
      input_tool_definition_regular_tokens: tokenUsage.custom?.input.segments['tool_regular']?.tokens || 0,
      input_tool_use_mcp_tokens: tokenUsage.custom?.input.segments['tool_use_mcp']?.tokens || 0,
      input_tool_use_regular_tokens: tokenUsage.custom?.input.segments['tool_use_regular']?.tokens || 0,
      input_tool_return_mcp_tokens: tokenUsage.custom?.input.segments['tool_return_mcp']?.tokens || 0,
      input_tool_return_regular_tokens: tokenUsage.custom?.input.segments['tool_return_regular']?.tokens || 0,
      output_tool_use_mcp_tokens: tokenUsage.custom?.output.segments['tool_use_mcp']?.tokens || 0,
      output_tool_use_regular_tokens: tokenUsage.custom?.output.segments['tool_use_regular']?.tokens || 0,
    });
  }

  const logsWithTools = new Set(toolCalls.map(tc => tc.logId)).size;

  return {
    toolCalls,
    usage,
    totalLogs: logs.length,
    logsWithTools,
  };
}

export default function Dashboard() {
  const location = useLocation();
  const navigate = useNavigate();
  const selectedLogIds = (location.state as { logIds?: string[] })?.logIds;

  const [data, setData] = useState<ToolMetricsDataResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDataAndAggregate() {
      try {
        setIsLoading(true);
        setError(null);

        // If no log IDs provided, fetch all logs from timeline
        let fileNames = selectedLogIds;
        if (!fileNames || fileNames.length === 0) {
          const listResponse = await fetch('/api/logs?limit=1000');
          if (!listResponse.ok) {
            throw new Error(`Failed to fetch log list: ${listResponse.statusText}`);
          }
          const listResult = await listResponse.json();
          fileNames = listResult.items.map((item: { fileName: string }) => item.fileName);
        }

        // Fetch full logs via batch endpoint
        const batchResponse = await fetch('/api/logs/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileNames }),
        });

        if (!batchResponse.ok) {
          throw new Error(`Failed to fetch logs: ${batchResponse.statusText}`);
        }

        const batchResult = await batchResponse.json();
        const logs: InteractionLog[] = batchResult.logs;

        // Aggregate client-side
        const aggregated = aggregateMetrics(logs);
        setData(aggregated);
      } catch (err) {
        console.error('Error fetching tool metrics:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setIsLoading(false);
      }
    }

    fetchDataAndAggregate();
  }, [selectedLogIds]);

  // Compute some basic stats (only when data is available)
  const totalToolCalls = data?.toolCalls.length ?? 0;
  const toolCallsWithResults = data?.toolCalls.filter(tc => tc.returnTokens !== undefined).length ?? 0;
  const uniqueTools = data ? new Set(data.toolCalls.map((tc) => tc.toolName)).size : 0;

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Tool Metrics Dashboard</h1>
        <button onClick={() => navigate(-1)} className="secondary-button">← Back to Timeline</button>
      </div>

      {isLoading && (
        <div className="dashboard-loading">Loading metrics data...</div>
      )}

      {error && (
        <div className="dashboard-error">
          <p>Error loading metrics: {error}</p>
        </div>
      )}

      {!isLoading && !error && !data && (
        <div className="dashboard-empty">No data available</div>
      )}

      {!isLoading && !error && data && (
        <>
          <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">Total Logs</div>
          <div className="stat-value">{data.totalLogs}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Logs with Tools</div>
          <div className="stat-value">{data.logsWithTools}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unique Tool Calls</div>
          <div className="stat-value">{totalToolCalls}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Calls with Results</div>
          <div className="stat-value">{toolCallsWithResults}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unique Tools</div>
          <div className="stat-value">{uniqueTools}</div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-charts">
          <TokenBreakdownChart data={data.usage} toolCalls={data.toolCalls} />
          <ToolUsageChart data={data.toolCalls} />
          <ToolReturnSizeChart data={data.toolCalls} />
        </div>

        <div className="dashboard-section">
          <h2>Raw Data</h2>
          <p>Unique Tool Calls: {data.toolCalls.length}</p>
          <p>Tool Calls with Results: {toolCallsWithResults}</p>
          <details>
            <summary>View Raw Data (Click to expand)</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </div>
      </div>
        </>
      )}
    </div>
  );
}