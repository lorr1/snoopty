/**
 * ToolReturnSizeChart
 *
 * Shows distribution of tool return token sizes.
 * Can display as box plot, scatter, or histogram.
 */

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { ToolResultRow } from '../../../../shared/types';

interface ToolReturnSizeChartProps {
  data: ToolResultRow[];
}

export default function ToolReturnSizeChart({ data }: ToolReturnSizeChartProps): JSX.Element {
  if (data.length === 0) {
    return <div className="chart-empty">No tool result data available</div>;
  }

  // Aggregate stats by tool
  const toolStats = new Map<string, { values: number[], avg: number, max: number, min: number }>();

  for (const row of data) {
    let stats = toolStats.get(row.toolName);
    if (!stats) {
      stats = { values: [], avg: 0, max: 0, min: Infinity };
      toolStats.set(row.toolName, stats);
    }
    stats.values.push(row.returnTokens);
  }

  // Compute averages and format for chart
  const chartData = Array.from(toolStats.entries())
    .map(([name, stats]) => {
      const avg = stats.values.reduce((sum, v) => sum + v, 0) / stats.values.length;
      const max = Math.max(...stats.values);
      const min = Math.min(...stats.values);
      return {
        toolName: name,
        avgTokens: Math.round(avg),
        maxTokens: max,
        minTokens: min,
        resultCount: stats.values.length,
      };
    })
    .sort((a, b) => b.avgTokens - a.avgTokens);

  return (
    <div className="chart-container">
      <h3>Tool Return Sizes (Tokens)</h3>
      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="toolName"
            angle={-45}
            textAnchor="end"
            height={100}
            type="category"
            interval={0}
          />
          <YAxis
            label={{ value: 'Return Tokens', angle: -90, position: 'insideLeft' }}
            type="number"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div style={{
                    background: 'white',
                    padding: '10px',
                    border: '1px solid #ccc',
                    borderRadius: '4px'
                  }}>
                    <p><strong>{data.toolName}</strong></p>
                    <p>Avg: {data.avgTokens} tokens</p>
                    <p>Max: {data.maxTokens} tokens</p>
                    <p>Min: {data.minTokens} tokens</p>
                    <p>Results: {data.resultCount}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend />
          <Scatter
            name="Average Return Size"
            data={chartData}
            fill="#82ca9d"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}