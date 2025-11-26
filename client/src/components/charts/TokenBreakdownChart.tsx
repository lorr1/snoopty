import React, { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ToolUsageRow } from '../../../../shared/types';
import { AGENT_TAG_COLORS, DEFAULT_CHART_COLOR, DEFAULT_STROKE_COLOR, TOKEN_COLORS } from '../../constants/colors';

interface TokenBreakdownChartProps {
  data: ToolUsageRow[];
}

interface ScatterPoint {
  timestamp: number;
  totalTokens: number;
  index: number;
  agentTag?: string;
  model?: string;
  logId: string;
}

interface PieChartData {
  name: string;
  value: number;
  color: string;
  [key: string]: string | number;
}

const TokenBreakdownChart: React.FC<TokenBreakdownChartProps> = ({ data }) => {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [inputDrillDown, setInputDrillDown] = useState(false);
  const [outputDrillDown, setOutputDrillDown] = useState(false);

  // Prepare scatter plot data
  const scatterData: ScatterPoint[] = useMemo(() => {
    return data.map((row, index) => {
      const totalTokens =
        (row.input_system_tokens || 0) +
        (row.input_user_tokens || 0) +
        (row.input_assistant_tokens || 0) +
        (row.input_thinking_tokens || 0) +
        (row.input_tool_definition_tokens || 0) +
        (row.input_tool_use_tokens || 0) +
        (row.input_tool_return_tokens || 0) +
        (row.output_assistant_tokens || 0) +
        (row.output_thinking_tokens || 0) +
        (row.output_tool_use_tokens || 0);

      return {
        timestamp: new Date(row.timestamp).getTime(),
        totalTokens,
        index,
        agentTag: row.agentTag,
        model: row.model,
        logId: row.logId,
      };
    });
  }, [data]);

  // Get selected request data
  const selectedRequest = selectedIndex !== null ? data[selectedIndex] : null;

  // Format input pie chart data
  const inputPieData: PieChartData[] = useMemo(() => {
    if (!selectedRequest) return [];

    if (inputDrillDown) {
      // Expanded view - show all segments
      return [
        {
          name: 'System',
          value: selectedRequest.input_system_tokens || 0,
          color: TOKEN_COLORS.system,
        },
        {
          name: 'User',
          value: selectedRequest.input_user_tokens || 0,
          color: TOKEN_COLORS.user,
        },
        {
          name: 'Assistant',
          value: selectedRequest.input_assistant_tokens || 0,
          color: TOKEN_COLORS.assistant,
        },
        {
          name: 'Thinking',
          value: selectedRequest.input_thinking_tokens || 0,
          color: TOKEN_COLORS.thinking,
        },
        {
          name: 'Tool Definitions',
          value: selectedRequest.input_tool_definition_tokens || 0,
          color: '#f97316',
        },
        {
          name: 'Tool Use',
          value: selectedRequest.input_tool_use_tokens || 0,
          color: '#fb923c',
        },
        {
          name: 'Tool Returns',
          value: selectedRequest.input_tool_return_tokens || 0,
          color: '#fdba74',
        },
      ].filter((item) => item.value > 0);
    } else {
      // Grouped view
      const toolsTotal =
        (selectedRequest.input_tool_definition_tokens || 0) +
        (selectedRequest.input_tool_use_tokens || 0) +
        (selectedRequest.input_tool_return_tokens || 0);

      return [
        {
          name: 'System',
          value: selectedRequest.input_system_tokens || 0,
          color: TOKEN_COLORS.system,
        },
        {
          name: 'User',
          value: selectedRequest.input_user_tokens || 0,
          color: TOKEN_COLORS.user,
        },
        {
          name: 'Assistant',
          value: selectedRequest.input_assistant_tokens || 0,
          color: TOKEN_COLORS.assistant,
        },
        {
          name: 'Thinking',
          value: selectedRequest.input_thinking_tokens || 0,
          color: TOKEN_COLORS.thinking,
        },
        {
          name: 'Tools',
          value: toolsTotal,
          color: TOKEN_COLORS.tools,
        },
      ].filter((item) => item.value > 0);
    }
  }, [selectedRequest, inputDrillDown]);

  // Format output pie chart data
  const outputPieData: PieChartData[] = useMemo(() => {
    if (!selectedRequest) return [];

    return [
      {
        name: 'Assistant',
        value: selectedRequest.output_assistant_tokens || 0,
        color: TOKEN_COLORS.assistant,
      },
      {
        name: 'Thinking',
        value: selectedRequest.output_thinking_tokens || 0,
        color: TOKEN_COLORS.thinking,
      },
      {
        name: 'Tool Use',
        value: selectedRequest.output_tool_use_tokens || 0,
        color: TOKEN_COLORS.toolsOutput,
      },
    ].filter((item) => item.value > 0);
  }, [selectedRequest]);

  // Custom tooltip for scatter plot
  const CustomScatterTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length > 0) {
      const point = payload[0].payload as ScatterPoint;
      return (
        <div
          style={{
            backgroundColor: 'white',
            padding: '10px',
            border: '1px solid #e2e8f0',
            borderRadius: '4px',
          }}
        >
          <p style={{ margin: '0 0 5px 0', fontSize: '12px', color: '#64748b' }}>
            {new Date(point.timestamp).toLocaleString()}
          </p>
          <p style={{ margin: '0 0 5px 0', fontWeight: 'bold' }}>
            Total: {point.totalTokens.toLocaleString()} tokens
          </p>
          {point.agentTag && (
            <p style={{ margin: '0 0 5px 0', fontSize: '12px' }}>
              Agent: {point.agentTag}
            </p>
          )}
          {point.model && (
            <p style={{ margin: '0', fontSize: '12px' }}>Model: {point.model}</p>
          )}
        </div>
      );
    }
    return null;
  };

  // Handle scatter plot click
  const handleScatterClick = (data: any) => {
    if (data && data.index !== undefined) {
      setSelectedIndex(data.index);
      setInputDrillDown(false);
      setOutputDrillDown(false);
    }
  };

  // Handle pie slice click for drill-down
  const handleInputPieClick = (entry: PieChartData) => {
    if (entry.name === 'Tools' && !inputDrillDown) {
      setInputDrillDown(true);
    }
  };

  const handleOutputPieClick = (entry: PieChartData) => {
    // Output pie doesn't have grouped categories currently
    // Could add drill-down if needed
  };

  // Custom shape renderer for scatter plot dots - colors by agent tag
  const renderColoredDot = (props: any) => {
    console.log('AGENT_TAG_COLORS:', AGENT_TAG_COLORS, props.payload.agentTag);
    const { cx, cy, payload } = props;
    const agentTag = payload.agentTag || 'Untagged';
    const color = AGENT_TAG_COLORS[agentTag] || DEFAULT_CHART_COLOR;

    return (
      <circle
        cx={cx}
        cy={cy}
        r={6}
        fill={color}
        stroke={DEFAULT_STROKE_COLOR}
        strokeWidth={1}
        style={{ cursor: 'pointer' }}
      />
    );
  };

  // Calculate total for pie chart percentages
  const inputTotal = inputPieData.reduce((sum, item) => sum + item.value, 0);
  const outputTotal = outputPieData.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="chart-container">
      <h3>Token Breakdown per Request</h3>

      {/* Scatter Plot */}
      <div style={{ marginBottom: '20px' }}>
        <ResponsiveContainer width="100%" height={300}>
          <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(timestamp) => new Date(timestamp).toLocaleDateString()}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis
              dataKey="totalTokens"
              type="number"
              label={{
                value: 'Total Tokens',
                angle: -90,
                position: 'insideLeft',
                offset: 10,
              }}
              width={80}
            />
            <Tooltip content={<CustomScatterTooltip />} />
            <Scatter
              data={scatterData}
              fill={DEFAULT_CHART_COLOR}
              onClick={handleScatterClick}
              shape={renderColoredDot}
            />
          </ScatterChart>
        </ResponsiveContainer>

        {/* Agent Tag Legend */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          justifyContent: 'center',
          marginTop: '10px',
          fontSize: '12px'
        }}>
          {Object.entries(AGENT_TAG_COLORS).map(([agentName, color]) => (
            <div key={agentName} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: color,
                border: `1px solid ${DEFAULT_STROKE_COLOR}`,
                boxShadow: '0 0 2px rgba(0,0,0,0.2)'
              }} />
              <span style={{ color: '#64748b' }}>
                {agentName}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Selected Request Info */}
      {selectedRequest && (
        <div
          style={{
            marginBottom: '20px',
            padding: '10px',
            backgroundColor: '#f8fafc',
            borderRadius: '4px',
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'flex', gap: '30px', flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: '0 0 5px 0', fontSize: '14px' }}>
                <strong>Selected Request:</strong>{' '}
                {new Date(selectedRequest.timestamp).toLocaleString()}
              </p>
              <p style={{ margin: '0 0 5px 0', fontSize: '14px' }}>
                <strong>Log ID:</strong> {selectedRequest.logId}
              </p>
              {selectedRequest.agentTag && (
                <p style={{ margin: '0 0 5px 0', fontSize: '14px' }}>
                  <strong>Agent:</strong> {selectedRequest.agentTag}
                </p>
              )}
              {selectedRequest.model && (
                <p style={{ margin: '0', fontSize: '14px' }}>
                  <strong>Model:</strong> {selectedRequest.model}
                </p>
              )}
            </div>
            <div
              style={{
                marginLeft: 'auto',
                padding: '10px 20px',
                backgroundColor: '#fff',
                borderRadius: '4px',
                border: '1px solid #e2e8f0',
              }}
            >
              <p
                style={{
                  margin: '0 0 8px 0',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#0ea5e9',
                }}
              >
                Total Input: {inputTotal.toLocaleString()} tokens
              </p>
              <p
                style={{
                  margin: '0',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#22c55e',
                }}
              >
                Total Output: {outputTotal.toLocaleString()} tokens
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Dual Pie Charts */}
      {selectedRequest && (
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          {/* Input Pie Chart */}
          <div style={{ flex: '1', minWidth: '300px' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '10px' }}>
              Input Tokens ({inputTotal.toLocaleString()})
              {!inputDrillDown && inputPieData.some((d) => d.name === 'Tools') && (
                <span style={{ fontSize: '12px', color: '#64748b', marginLeft: '10px' }}>
                  (click Tools to expand)
                </span>
              )}
              {inputDrillDown && (
                <button
                  onClick={() => setInputDrillDown(false)}
                  style={{
                    marginLeft: '10px',
                    fontSize: '12px',
                    padding: '2px 8px',
                    cursor: 'pointer',
                  }}
                >
                  Collapse
                </button>
              )}
            </h4>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={inputPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={(entry) => {
                    const percent = ((entry.value / inputTotal) * 100).toFixed(1);
                    return `${entry.name} (${percent}%)`;
                  }}
                  onClick={handleInputPieClick}
                  style={{ cursor: 'pointer' }}
                >
                  {inputPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => value.toLocaleString() + ' tokens'}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Output Pie Chart */}
          <div style={{ flex: '1', minWidth: '300px' }}>
            <h4 style={{ textAlign: 'center', marginBottom: '10px' }}>
              Output Tokens ({outputTotal.toLocaleString()})
            </h4>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={outputPieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={(entry) => {
                    const percent = ((entry.value / outputTotal) * 100).toFixed(1);
                    return `${entry.name} (${percent}%)`;
                  }}
                  onClick={handleOutputPieClick}
                >
                  {outputPieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => value.toLocaleString() + ' tokens'}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Initial state message */}
      {!selectedRequest && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            color: '#64748b',
            fontSize: '14px',
          }}
        >
          Click on a point in the scatter plot to see its token breakdown
        </div>
      )}
    </div>
  );
};

export default TokenBreakdownChart;
