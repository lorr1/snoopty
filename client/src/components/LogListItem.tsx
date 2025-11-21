import type { AgentTagInfo, LogSummary } from '../../../shared/types';
import { formatTimeOfDay, formatTimestamp, formatDuration } from '../utils/formatting';
import { buildTokenChips } from '../utils/tokenHelpers';
import { getEndpointCategory, ENDPOINT_STYLES } from '../hooks';

const FALLBACK_AGENT_TAG: AgentTagInfo = {
  id: 'untagged',
  label: 'Untagged',
  description: 'No system prompt detected for this request.',
  theme: {
    text: '#0f172a',
    background: 'rgba(15, 23, 42, 0.08)',
    border: 'rgba(15, 23, 42, 0.2)',
  },
};

interface LogListItemProps {
  entry: LogSummary;
  isActive: boolean;
  isChecked: boolean;
  maxDuration: number;
  onClick: () => void;
  onToggleSelection: () => void;
}

export default function LogListItem({
  entry,
  isActive,
  isChecked,
  maxDuration,
  onClick,
  onToggleSelection,
}: LogListItemProps): JSX.Element {
  const duration = entry.durationMs ?? 0;
  const percent =
    maxDuration > 0
      ? Math.max((duration / maxDuration) * 100, duration > 0 ? 6 : 0)
      : 0;
  const tokenChips = buildTokenChips(entry.tokenUsage?.totals);
  const endpointCategory = getEndpointCategory(entry.path);
  const endpointTheme = ENDPOINT_STYLES[endpointCategory];
  const startedAtLabel = formatTimeOfDay(entry.timestamp);
  const fullStartLabel = formatTimestamp(entry.timestamp);
  const durationLabel = formatDuration(entry.durationMs);
  const footerText = entry.error
    ? entry.error
    : typeof entry.status === 'number'
      ? String(entry.status)
      : '—';
  const footerTextClass = entry.error
    ? 'timeline-row__footer-text timeline-row__footer-text--error'
    : 'timeline-row__footer-text';
  const agentChip = entry.agentTag ?? FALLBACK_AGENT_TAG;

  return (
    <li
      className={`timeline-row${isActive ? ' timeline-row--active' : ''}`}
      onClick={onClick}
      style={{
        backgroundColor: endpointTheme.cardBg,
        borderColor: endpointTheme.cardBorder,
      }}
    >
      <div className="timeline-row__content">
        <div className="timeline-row__selection">
          <input
            type="checkbox"
            checked={isChecked}
            onChange={onToggleSelection}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
        <div className="timeline-row__main">
          <div className="timeline-row__model-line">
            <div className="timeline-row__model">
              {entry.model ?? 'Unknown model'}
            </div>
            <span
              className="agent-chip timeline-row__agent-chip"
              style={{
                color: agentChip.theme.text,
                backgroundColor: agentChip.theme.background,
                borderColor: agentChip.theme.border,
              }}
              title={agentChip.description ?? agentChip.label}
            >
              {agentChip.label}
            </span>
          </div>
          {tokenChips.length > 0 && (
            <div className="timeline-row__tokens">
              {tokenChips.map((chip) => (
                <span
                  key={chip.key}
                  className={`timeline-row__token-chip timeline-row__token-chip--${chip.key}`}
                >
                  {chip.label} {chip.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="timeline-row__footer">
        <span
          className="timeline-row__footer-time"
          title={fullStartLabel}
        >
          {startedAtLabel}
        </span>
        <span className="timeline-row__footer-duration">{durationLabel}</span>
        <div className="timeline-row__duration-track">
          <div
            className="timeline-row__duration-bar"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className={footerTextClass}>{footerText}</span>
      </div>
    </li>
  );
}
