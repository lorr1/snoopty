import type { ChangeEvent } from 'react';
import type { EndpointFilter, AgentFilter } from '../hooks';

const MAX_FILTER_DAYS = 30;

const ENDPOINT_FILTER_OPTIONS: Array<{ id: EndpointFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'other', label: 'Meta' },
];

interface FilterControlsProps {
  timeWindowDays: number;
  endpointFilter: EndpointFilter;
  agentFilter: AgentFilter;
  agentFilterOptions: Array<{ id: AgentFilter; label: string }>;
  selectionActive: boolean;
  filteredFileNamesCount: number;
  isExporting: boolean;
  onTimeWindowChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onEndpointFilterChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onAgentFilterChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  onClearTimeSelection: () => void;
  onExportFiltered: () => void;
}

export default function FilterControls({
  timeWindowDays,
  endpointFilter,
  agentFilter,
  agentFilterOptions,
  selectionActive,
  filteredFileNamesCount,
  isExporting,
  onTimeWindowChange,
  onEndpointFilterChange,
  onAgentFilterChange,
  onClearTimeSelection,
  onExportFiltered,
}: FilterControlsProps): JSX.Element {
  return (
    <div className="timeseries-controls">
      <div className="timeseries-controls__left">
        <label className="timeseries-controls__range">
          Show past
          <input
            type="number"
            min={1}
            max={MAX_FILTER_DAYS}
            value={timeWindowDays}
            onChange={onTimeWindowChange}
          />
          day(s)
        </label>
        <label className="timeseries-controls__endpoint">
          Endpoint
          <select value={endpointFilter} onChange={onEndpointFilterChange}>
            {ENDPOINT_FILTER_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="timeseries-controls__endpoint">
          Agent
          <select value={agentFilter} onChange={onAgentFilterChange}>
            {agentFilterOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="text-button"
          onClick={onClearTimeSelection}
          disabled={!selectionActive}
        >
          Clear Selection
        </button>
      </div>
      <div className="timeseries-controls__right">
        <button
          type="button"
          className="secondary-button"
          onClick={onExportFiltered}
          disabled={filteredFileNamesCount === 0 || isExporting}
        >
          {isExporting ? 'Exporting…' : 'Export Parquet'}
        </button>
      </div>
    </div>
  );
}
