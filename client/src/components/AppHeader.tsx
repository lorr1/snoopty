import { Link } from 'react-router-dom';

interface AppHeaderProps {
  isLoading: boolean;
  hasFirstPageLoaded: boolean;
  isRecomputing: boolean;
  filteredLogsCount: number;
  filteredFileNames: string[];
  recomputeMessage: string | null;
  onRefresh: () => void;
  onRecompute: () => void;
}

export default function AppHeader({
  isLoading,
  hasFirstPageLoaded,
  isRecomputing,
  filteredLogsCount,
  filteredFileNames,
  recomputeMessage,
  onRefresh,
  onRecompute,
}: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-brand">
        <h1>Snoopty</h1>
        <p className="app-tagline">Claude Code Inspector</p>
      </div>
      <div className="header-actions">
        <Link to="/dashboard" state={{ logIds: filteredFileNames }} className="secondary-button">
          Dashboard
        </Link>
        <button
          type="button"
          className="secondary-button"
          onClick={onRefresh}
          disabled={isLoading && !hasFirstPageLoaded}
        >
          {isLoading && !hasFirstPageLoaded ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={onRecompute}
          disabled={isRecomputing}
        >
          {isRecomputing ? 'Recomputing…' : 'Recompute Metadata'}
        </button>
        <span className="header-status">
          {isLoading && !hasFirstPageLoaded
            ? 'Loading logs…'
            : `Showing ${filteredLogsCount} interactions`}
        </span>
        {recomputeMessage && (
          <span className="header-status header-status--muted">{recomputeMessage}</span>
        )}
      </div>
    </header>
  );
}
