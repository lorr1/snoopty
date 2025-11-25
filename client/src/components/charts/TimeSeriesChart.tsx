/**
 * TimeSeriesChart
 *
 * Line chart showing tool usage over time.
 * Groups data by time buckets.
 */

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ToolCallRow } from '../../../../shared/types';

interface TimeSeriesChartProps {
  data: ToolCallRow[];
}

export default function TimeSeriesChart({ data }: TimeSeriesChartProps): JSX.Element {
  if (data.length === 0) {
    return <div className="chart-empty">No time series data available</div>;
  }

  // Group by hour
  const hourlyData = new Map<string, { calls: number, uniqueTools: Set<string> }>();

  for (const row of data) {
    const date = new Date(row.timestamp);
    const hourKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;

    let bucket = hourlyData.get(hourKey);
    if (!bucket) {
      bucket = { calls: 0, uniqueTools: new Set() };
      hourlyData.set(hourKey, bucket);
    }

    bucket.calls += row.callCount;
    bucket.uniqueTools.add(row.toolName);
  }

  // Convert to array and sort by time
  const chartData = Array.from(hourlyData.entries())
    .map(([time, stats]) => ({
      time,
      calls: stats.calls,
      uniqueTools: stats.uniqueTools.size,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return (
    <div className="chart-container">
      <h3>Tool Usage Over Time (Hourly)</h3>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="time"
            angle={-45}
            textAnchor="end"
            height={100}
            interval="preserveStartEnd"
          />
          <YAxis label={{ value: 'Count', angle: -90, position: 'insideLeft' }} />
          <Tooltip />
          <Legend />
          <Line
            type="monotone"
            dataKey="calls"
            stroke="#8884d8"
            name="Total Calls"
            strokeWidth={2}
          />
          <Line
            type="monotone"
            dataKey="uniqueTools"
            stroke="#82ca9d"
            name="Unique Tools"
            strokeWidth={2}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}