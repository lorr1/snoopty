/**
 * ToolUsageChart
 *
 * Bar chart showing total call count per tool, split by MCP vs Regular tools.
 */

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UniqueToolCall } from '../../../../shared/types';
import { TOOL_TYPE_COLORS } from '../../constants/colors';

interface ToolUsageChartProps {
  data: UniqueToolCall[];
}

interface ChartDataItem {
  toolName: string;
  mcp: number;
  regular: number;
  total: number;
  logIds: string[];
}

const CustomTooltip = (props: any) => {
  const { active, payload } = props;

  if (!active || !payload || !payload.length) {
    return null;
  }

  const data = payload[0].payload as ChartDataItem;

  return (
    <div style={{
      backgroundColor: 'rgba(255, 255, 255, 0.95)',
      border: '1px solid #ccc',
      borderRadius: '4px',
      padding: '12px',
      maxWidth: '400px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
    }}>
      <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', fontSize: '14px' }}>
        {data.toolName}
      </p>
      <p style={{ margin: '4px 0', fontSize: '13px' }}>
        <span style={{ color: TOOL_TYPE_COLORS.toolUseMcp }}>MCP: {data.mcp}</span>
        {' | '}
        <span style={{ color: TOOL_TYPE_COLORS.toolUseRegular }}>Regular: {data.regular}</span>
      </p>
      <p style={{ margin: '4px 0', fontSize: '13px', fontWeight: '500' }}>
        Total: {data.total}
      </p>
      {data.logIds.length > 0 && (
        <>
          <hr style={{ margin: '8px 0', border: 'none', borderTop: '1px solid #eee' }} />
          <p style={{ margin: '4px 0 2px 0', fontSize: '12px', fontWeight: '500', color: '#666' }}>
            Log IDs ({data.logIds.length}):
          </p>
          <div style={{
            maxHeight: '150px',
            overflowY: 'auto',
            fontSize: '11px',
            fontFamily: 'monospace',
            color: '#333'
          }}>
            {data.logIds.map((id, idx) => (
              <div key={idx} style={{ padding: '2px 0' }}>
                {id}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default function ToolUsageChart({ data }: ToolUsageChartProps) {

  if (data.length === 0) {
    return <div className="chart-empty">No tool usage data available</div>;
  }

  // Count tool calls by tool name, split by tool type (mcp vs regular)
  // Also track log IDs for each tool
  const toolCounts = new Map<string, { mcp: number; regular: number; logIds: string[] }>();

  for (const toolCall of data) {
    if (!toolCounts.has(toolCall.toolName)) {
      toolCounts.set(toolCall.toolName, { mcp: 0, regular: 0, logIds: [] });
    }
    const counts = toolCounts.get(toolCall.toolName)!;
    if (toolCall.toolType === 'mcp') {
      counts.mcp += 1;
    } else {
      counts.regular += 1;
    }
    // Add log ID if not already present
    if (!counts.logIds.includes(toolCall.logId)) {
      counts.logIds.push(toolCall.logId);
    }
  }

  // Convert to array and sort by total count descending
  const chartData = Array.from(toolCounts.entries())
    .map(([name, counts]) => ({
      toolName: name,
      mcp: counts.mcp,
      regular: counts.regular,
      total: counts.mcp + counts.regular,
      logIds: counts.logIds,
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="chart-container">
      <h3>Tool Usage (Total Calls)</h3>
      <ResponsiveContainer width="100%" height={600}>
        <BarChart data={chartData} margin={{ top: 40, right: 30, left: 70, bottom: 150 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="toolName"
            angle={-45}
            textAnchor="end"
            height={120}
            interval={0}
          />
          <YAxis
            label={{ value: 'Call Count', angle: -90, position: 'insideLeft', offset: 10 }}
            width={60}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend verticalAlign="top" align="right" />
          <Bar dataKey="mcp" stackId="a" fill={TOOL_TYPE_COLORS.toolUseMcp} name="MCP Tools" />
          <Bar dataKey="regular" stackId="a" fill={TOOL_TYPE_COLORS.toolUseRegular} name="Regular Tools" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}