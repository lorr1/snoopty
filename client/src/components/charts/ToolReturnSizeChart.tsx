/**
 * ToolReturnSizeChart
 *
 * Shows total return token sizes by tool, split by MCP vs Regular tools.
 */

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { UniqueToolCall } from '../../../../shared/types';
import { TOOL_TYPE_COLORS } from '../../constants/colors';

interface ToolReturnSizeChartProps {
  data: UniqueToolCall[];
}

export default function ToolReturnSizeChart({ data }: ToolReturnSizeChartProps) {

  // Filter to only tool calls with return data
  const toolCallsWithReturns = data.filter(tc => tc.returnTokens !== undefined);

  if (toolCallsWithReturns.length === 0) {
    return <div className="chart-empty">No tool result data available</div>;
  }

  // Aggregate total return tokens by tool, split by tool type (mcp vs regular)
  const toolStats = new Map<string, {
    mcpTokens: number;
    mcpCount: number;
    regularTokens: number;
    regularCount: number;
  }>();

  for (const toolCall of toolCallsWithReturns) {
    if (!toolStats.has(toolCall.toolName)) {
      toolStats.set(toolCall.toolName, {
        mcpTokens: 0,
        mcpCount: 0,
        regularTokens: 0,
        regularCount: 0
      });
    }
    const stats = toolStats.get(toolCall.toolName)!;
    if (toolCall.toolType === 'mcp') {
      stats.mcpTokens += toolCall.returnTokens!;
      stats.mcpCount++;
    } else {
      stats.regularTokens += toolCall.returnTokens!;
      stats.regularCount++;
    }
  }

  // Format for chart
  const chartData = Array.from(toolStats.entries())
    .map(([name, stats]) => ({
      toolName: name,
      mcpTokens: stats.mcpTokens,
      regularTokens: stats.regularTokens,
      totalTokens: stats.mcpTokens + stats.regularTokens,
      mcpCount: stats.mcpCount,
      regularCount: stats.regularCount,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return (
    <div className="chart-container">
      <h3>Tool Return Sizes (Tokens)</h3>
      <ResponsiveContainer width="100%" height={400}>
        <BarChart data={chartData} margin={{ top: 20, right: 30, left: 100, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="toolName"
            angle={-45}
            textAnchor="end"
            height={100}
            interval={0}
          />
          <YAxis
            label={{ value: 'Return Tokens', angle: -90, position: 'insideLeft', offset: 20 }}
            width={80}
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
                    <p>MCP: {data.mcpTokens.toLocaleString()} tokens ({data.mcpCount} results)</p>
                    <p>Regular: {data.regularTokens.toLocaleString()} tokens ({data.regularCount} results)</p>
                    <p><strong>Total: {data.totalTokens.toLocaleString()} tokens</strong></p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend />
          <Bar dataKey="mcpTokens" stackId="a" fill={TOOL_TYPE_COLORS.mcp} name="MCP Tool Returns" />
          <Bar dataKey="regularTokens" stackId="a" fill={TOOL_TYPE_COLORS.regularReturns} name="Regular Tool Returns" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}