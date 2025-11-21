import type { LogSummary } from '../../../shared/types';
import { formatRelativeDate } from '../utils/formatting';
import LogListItem from './LogListItem';

type GroupedLogs = Array<{
  key: string;
  label: string;
  items: LogSummary[];
}>;

function groupLogs(items: LogSummary[]): GroupedLogs {
  const groups = new Map<string, { label: string; items: LogSummary[] }>();

  for (const entry of items) {
    const date = new Date(entry.timestamp);
    const key = date.toISOString().slice(0, 10);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(entry);
    } else {
      groups.set(key, {
        label: formatRelativeDate(date),
        items: [entry],
      });
    }
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => (a > b ? -1 : 1))
    .map(([key, group]) => ({
      key,
      label: group.label,
      items: group.items.sort(
        (left, right) =>
          new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime()
      ),
    }));
}

interface TimelineListSectionProps {
  filteredLogs: LogSummary[];
  selectedFileName: string | null;
  selectedFiles: Set<string>;
  hasSelection: boolean;
  selectedCount: number;
  isDeleting: boolean;
  maxDuration: number;
  listError: string | null;
  deleteError: string | null;
  exportError: string | null;
  hasFirstPageLoaded: boolean;
  isLoading: boolean;
  onSelectFileName: (fileName: string) => void;
  onToggleSelection: (fileName: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
}

export default function TimelineListSection({
  filteredLogs,
  selectedFileName,
  selectedFiles,
  hasSelection,
  selectedCount,
  isDeleting,
  maxDuration,
  listError,
  deleteError,
  exportError,
  hasFirstPageLoaded,
  isLoading,
  onSelectFileName,
  onToggleSelection,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
}: TimelineListSectionProps): JSX.Element {
  const groupedLogs = groupLogs(filteredLogs);

  return (
    <section className="timeline-panel">
      <div className="timeline-banner">No older items in the selected time window.</div>
      <div className="timeline-toolbar">
        <div className="timeline-toolbar__left">
          <button
            type="button"
            className="danger-button"
            onClick={onDeleteSelected}
            disabled={!hasSelection || isDeleting}
          >
            {isDeleting ? 'Deleting…' : 'Delete Selected'}
          </button>
          <span className="timeline-selection-count">{selectedCount} selected</span>
        </div>
        <div className="timeline-toolbar__right">
          <button
            type="button"
            className="text-button"
            onClick={onSelectAll}
            disabled={filteredLogs.length === 0}
          >
            Select All
          </button>
          <button
            type="button"
            className="text-button"
            onClick={onClearSelection}
            disabled={!hasSelection}
          >
            Clear
          </button>
        </div>
      </div>
      {(listError || deleteError || exportError) && (
        <div className="panel-messages">
          {listError && <span className="error-text">{listError}</span>}
          {deleteError && <span className="error-text">{deleteError}</span>}
          {exportError && <span className="error-text">{exportError}</span>}
        </div>
      )}
      <div className="timeline-groups">
        {groupedLogs.map((group) => (
          <div className="timeline-group" key={group.key}>
            <div className="timeline-group__label">{group.label}</div>
            <ul className="timeline-group__list">
              {group.items.map((entry) => (
                <LogListItem
                  key={entry.fileName}
                  entry={entry}
                  isActive={entry.fileName === selectedFileName}
                  isChecked={selectedFiles.has(entry.fileName)}
                  maxDuration={maxDuration}
                  onClick={() => onSelectFileName(entry.fileName)}
                  onToggleSelection={() => onToggleSelection(entry.fileName)}
                />
              ))}
            </ul>
          </div>
        ))}
        {groupedLogs.length === 0 && (hasFirstPageLoaded || !isLoading) && (
          <div className="empty-state">No interactions captured yet.</div>
        )}
      </div>
    </section>
  );
}
