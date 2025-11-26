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

export default function ToolUsageChart({ data }: ToolUsageChartProps): JSX.Element {

  if (data.length === 0) {
    return <div className="chart-empty">No tool usage data available</div>;
  }

  // Count tool calls by tool name, split by tool type (mcp vs regular)
  const toolCounts = new Map<string, { mcp: number; regular: number }>();

  for (const toolCall of data) {
    if (!toolCounts.has(toolCall.toolName)) {
      toolCounts.set(toolCall.toolName, { mcp: 0, regular: 0 });
    }
    const counts = toolCounts.get(toolCall.toolName)!;
    if (toolCall.toolType === 'mcp') {
      counts.mcp += 1;
    } else {
      counts.regular += 1;
    }
  }

  // Convert to array and sort by total count descending
  const chartData = Array.from(toolCounts.entries())
    .map(([name, counts]) => ({
      toolName: name,
      mcp: counts.mcp,
      regular: counts.regular,
      total: counts.mcp + counts.regular,
    }))
    .sort((a, b) => b.total - a.total);

  return (
    <div className="chart-container">
      <h3>Tool Usage (Total Calls)</h3>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 70, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="toolName"
            angle={-45}
            textAnchor="end"
            height={100}
            interval={0}
          />
          <YAxis
            label={{ value: 'Call Count', angle: -90, position: 'insideLeft', offset: 10 }}
            width={60}
          />
          <Tooltip />
          <Legend />
          <Bar dataKey="mcp" stackId="a" fill={TOOL_TYPE_COLORS.mcp} name="MCP Tools" />
          <Bar dataKey="regular" stackId="a" fill={TOOL_TYPE_COLORS.regular} name="Regular Tools" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}