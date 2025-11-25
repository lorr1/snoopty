/**
 * Dashboard Page
 *
 * Displays aggregate metrics and visualizations for tool usage.
 * Fetches full InteractionLogs and aggregates client-side.
 * Uses Recharts for all visualizations.
 */

import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type {
  InteractionLog,
  ToolMetricsDataResponse,
  ToolCallRow,
  ToolResultRow,
} from '../../../shared/types';
import ToolUsageChart from '../components/charts/ToolUsageChart';
import ToolReturnSizeChart from '../components/charts/ToolReturnSizeChart';
import TimeSeriesChart from '../components/charts/TimeSeriesChart';

/**
 * Aggregate metrics from InteractionLogs client-side.
 * Extracts tool metrics and flattens them into chart-ready rows.
 */
function aggregateMetrics(logs: InteractionLog[]): ToolMetricsDataResponse {
  const calls: ToolCallRow[] = [];
  const results: ToolResultRow[] = [];
  let logsWithTools = 0;

  for (const log of logs) {
    const { toolMetrics, agentTag, request, timestamp, id } = log;

    if (!toolMetrics || !toolMetrics.tools || toolMetrics.tools.length === 0) {
      continue;
    }

    logsWithTools++;

    // Extract model from request
    const body = request.body as { model?: string } | undefined;
    const model = body?.model;
    const agentTagLabel = agentTag?.label;

    // Flatten tool usage into rows
    for (const tool of toolMetrics.tools) {
      if (tool.callCount > 0) {
        calls.push({
          logId: id,
          timestamp,
          toolName: tool.toolName,
          callCount: tool.callCount,
          agentTag: agentTagLabel,
          model,
        });
      }

      // Flatten individual return tokens
      for (const returnTokens of tool.returnTokenCounts) {
        results.push({
          logId: id,
          timestamp,
          toolName: tool.toolName,
          returnTokens,
          agentTag: agentTagLabel,
          model,
        });
      }
    }
  }

  return {
    calls,
    results,
    filters: {},
    totalLogs: logs.length,
    logsWithTools,
  };
}

export default function Dashboard(): JSX.Element {
  const location = useLocation();
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

  if (isLoading) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>Dashboard</h1>
          <Link to="/" className="back-link">← Back to Timeline</Link>
        </div>
        <div className="dashboard-loading">Loading metrics data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>Dashboard</h1>
          <Link to="/" className="back-link">← Back to Timeline</Link>
        </div>
        <div className="dashboard-error">
          <p>Error loading metrics: {error}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <h1>Dashboard</h1>
          <Link to="/" className="back-link">← Back to Timeline</Link>
        </div>
        <div className="dashboard-empty">No data available</div>
      </div>
    );
  }

  // Compute some basic stats
  const totalToolCalls = data.calls.reduce((sum, row) => sum + row.callCount, 0);
  const totalToolResults = data.results.length;
  const uniqueTools = new Set(data.results.map((r) => r.toolName)).size;

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>Tool Metrics Dashboard</h1>
        <Link to="/" className="back-link">← Back to Timeline</Link>
      </div>

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
          <div className="stat-label">Tool Calls</div>
          <div className="stat-value">{totalToolCalls}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tool Results</div>
          <div className="stat-value">{totalToolResults}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Unique Tools</div>
          <div className="stat-value">{uniqueTools}</div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-charts">
          <ToolUsageChart data={data.calls} />
          <ToolReturnSizeChart data={data.results} />
          <TimeSeriesChart data={data.calls} />
        </div>

        <div className="dashboard-section">
          <h2>Raw Data</h2>
          <p>Tool Calls: {data.calls.length} rows</p>
          <p>Tool Results: {data.results.length} rows</p>
          <details>
            <summary>View Raw Data (Click to expand)</summary>
            <pre>{JSON.stringify(data, null, 2)}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}