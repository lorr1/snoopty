/**
 * ToolUsageChart
 *
 * Bar chart showing total call count per tool.
 * Recharts handles aggregation - we just pass the raw call data.
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ToolCallRow } from '../../../../shared/types';

interface ToolUsageChartProps {
  data: ToolCallRow[];
}

export default function ToolUsageChart({ data }: ToolUsageChartProps): JSX.Element {
  // Aggregate by tool name
  const toolCounts = new Map<string, number>();

  for (const row of data) {
    const current = toolCounts.get(row.toolName) || 0;
    toolCounts.set(row.toolName, current + row.callCount);
  }

  // Convert to array and sort by count descending
  const chartData = Array.from(toolCounts.entries())
    .map(([name, count]) => ({ toolName: name, calls: count }))
    .sort((a, b) => b.calls - a.calls);

  if (chartData.length === 0) {
    return <div className="chart-empty">No tool usage data available</div>;
  }

  return (
    <div className="chart-container">
      <h3>Tool Usage (Total Calls)</h3>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="toolName"
            angle={-45}
            textAnchor="end"
            height={100}
            interval={0}
          />
          <YAxis label={{ value: 'Call Count', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Bar dataKey="calls" fill="#8884d8" name="Total Calls" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}