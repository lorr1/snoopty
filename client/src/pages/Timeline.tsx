import { useMemo } from 'react';
import TimelineBrush from '../components/TimelineBrush';
import AppHeader from '../components/AppHeader';
import FilterControls from '../components/FilterControls';
import TimelineListSection from '../components/TimelineListSection';
import DetailsPanel from '../components/DetailsPanel';
import { useLogData, useLogFiltering, useLogSelection } from '../hooks';

/**
 * Primary React view for Snoopty. The component manages three concerns:
 *  1. Polling `/api/logs` and normalizing the data for the timeline,
 *  2. Maintaining time-range selections (Logfire-style brush) and bulk actions,
 *  3. Rendering the detail pane with token summaries and raw payload inspectors.
 */

export default function Timeline(): JSX.Element {
  // Core data hook
  const {
    isLoading,
    hasFirstPageLoaded,
    listError,
    logsWithTime,
    earliestTimestampMs,
    latestTimestampMs,
    isRecomputing,
    recomputeMessage,
    fetchLogs,
    handleRecompute,
  } = useLogData();

  // Filtering hook
  const {
    timeWindowDays,
    endpointFilter,
    agentFilter,
    agentFilterOptions,
    filteredLogs,
    filteredFileNames,
    brushPoints,
    selectionActive,
    timelineRange,
    effectiveSelection,
    windowRange,
    handleTimeWindowInputChange,
    handleEndpointFilterChange,
    handleAgentFilterChange,
    handleBrushSelection,
    handleClearTimeSelection,
  } = useLogFiltering({
    logsWithTime,
    earliestTimestampMs,
    latestTimestampMs,
  });

  // Selection hook
  const {
    selectedFileName,
    selectedLog,
    detailError,
    isDetailLoading,
    selectedFiles,
    isDeleting,
    isExporting,
    deleteError,
    exportError,
    selectedCount,
    selectedSummary,
    hasSelection,
    selectedLogTimestamp,
    setSelectedFileName,
    toggleSelection,
    clearSelection,
    selectAll,
    handleDeleteSelected,
    handleExportFiltered,
  } = useLogSelection({
    filteredLogs,
    filteredFileNames,
    logsWithTime,
    fetchLogs,
  });

  // Compute max duration from filtered logs
  const maxDuration = useMemo(
    () => filteredLogs.reduce((acc, entry) => Math.max(acc, entry.durationMs ?? 0), 0),
    [filteredLogs]
  );

  return (
    <div className="app-shell">
      <AppHeader
        isLoading={isLoading}
        hasFirstPageLoaded={hasFirstPageLoaded}
        isRecomputing={isRecomputing}
        filteredLogsCount={filteredLogs.length}
        recomputeMessage={recomputeMessage}
        onRefresh={() => fetchLogs()}
        onRecompute={handleRecompute}
      />
      <main className="app-main">
        <div className="timeseries-header">
          <FilterControls
            timeWindowDays={timeWindowDays}
            endpointFilter={endpointFilter}
            agentFilter={agentFilter}
            agentFilterOptions={agentFilterOptions}
            selectionActive={selectionActive}
            filteredFileNamesCount={filteredFileNames.length}
            isExporting={isExporting}
            onTimeWindowChange={handleTimeWindowInputChange}
            onEndpointFilterChange={handleEndpointFilterChange}
            onAgentFilterChange={handleAgentFilterChange}
            onClearTimeSelection={handleClearTimeSelection}
            onExportFiltered={handleExportFiltered}
          />
          <TimelineBrush
            logs={brushPoints}
            range={timelineRange}
            effectiveSelection={effectiveSelection}
            selectionActive={selectionActive}
            activeTimestamp={selectedLogTimestamp}
            onSelectionChange={handleBrushSelection}
          />
        </div>
        <TimelineListSection
          filteredLogs={filteredLogs}
          selectedFileName={selectedFileName}
          selectedFiles={selectedFiles}
          hasSelection={hasSelection}
          selectedCount={selectedCount}
          isDeleting={isDeleting}
          maxDuration={maxDuration}
          listError={listError}
          deleteError={deleteError}
          exportError={exportError}
          hasFirstPageLoaded={hasFirstPageLoaded}
          isLoading={isLoading}
          onSelectFileName={setSelectedFileName}
          onToggleSelection={toggleSelection}
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
          onDeleteSelected={handleDeleteSelected}
        />
        <DetailsPanel
          selectedLog={selectedLog}
          selectedSummary={selectedSummary}
          isDetailLoading={isDetailLoading}
          detailError={detailError}
        />
      </main>
    </div>
  );
}
