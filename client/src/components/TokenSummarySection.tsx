import type { TokenUsageSummary } from '../../../shared/types';
import {
  formatTokenCount,
  buildTokenChips,
  buildCustomBreakdowns,
  type TokenChip,
  type CustomTokenBreakdowns,
} from '../utils/tokenHelpers';

interface TokenSummarySectionProps {
  tokenUsage: TokenUsageSummary;
}

export default function TokenSummarySection({
  tokenUsage,
}: TokenSummarySectionProps): JSX.Element {
  const systemChips = buildTokenChips(tokenUsage.totals);
  const customBreakdowns = buildCustomBreakdowns(tokenUsage.custom);

  // Calculate total usage tokens
  const totals = tokenUsage.totals;
  const values: Array<number | null | undefined> = [
    totals.inputTokens,
    totals.outputTokens,
    totals.cacheCreationInputTokens,
    totals.cacheReadInputTokens,
  ];
  const numeric = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  const totalUsageTokens = numeric.length === 0 ? null : numeric.reduce((acc, value) => acc + value, 0);

  return (
    <div className="token-summary">
      <div className="token-summary__section token-summary__section--system">
        <div className="token-summary__title">System Usage</div>
        <div className="token-summary__chips">
          {systemChips.length > 0 ? (
            systemChips.map((chip) => (
              <span
                key={chip.key}
                className={`timeline-row__token-chip timeline-row__token-chip--${chip.key}`}
              >
                {chip.label} {chip.value}
              </span>
            ))
          ) : (
            <span className="token-summary__empty">Not reported by Anthropic</span>
          )}
        </div>
        <div className="token-summary__meta">
          Cache created {formatTokenCount(tokenUsage.totals.cacheCreationInputTokens)} · Cache read{' '}
          {formatTokenCount(tokenUsage.totals.cacheReadInputTokens)}
        </div>
        {totalUsageTokens !== null && (
          <div className="token-summary__total">
            Total (In + Out + Cache Created + Cache Read):{' '}
            <strong>{formatTokenCount(totalUsageTokens)}</strong>
          </div>
        )}
      </div>
      <div className="token-summary__section token-summary__section--custom">
        <div className="token-summary__title">
          Custom Counts
          {tokenUsage.custom && (
            <span className="token-summary__subtitle"></span>
          )}
        </div>
        {customBreakdowns ? (
          <div className="token-summary__io-container">
            <div className="token-summary__io-section">
              <div className="token-summary__io-header">
                <span className="token-summary__io-label">Input</span>
                <span className="token-summary__io-total">{formatTokenCount(customBreakdowns.input.total)}</span>
              </div>
              <div className="token-summary__grid">
                {customBreakdowns.input.rows.map((row) => (
                  <div
                    className={`token-summary__row token-summary__row--${row.variant}`}
                    key={row.key}
                  >
                    <span className="token-summary__row-label">{row.label}</span>
                    <span className="token-summary__row-value">{row.value}</span>
                    <span className="token-summary__row-detail">{row.detail}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="token-summary__io-section">
              <div className="token-summary__io-header">
                <span className="token-summary__io-label">Output</span>
                <span className="token-summary__io-total">{formatTokenCount(customBreakdowns.output.total)}</span>
              </div>
              <div className="token-summary__grid">
                {customBreakdowns.output.rows.map((row) => (
                  <div
                    className={`token-summary__row token-summary__row--${row.variant}`}
                    key={row.key}
                  >
                    <span className="token-summary__row-label">{row.label}</span>
                    <span className="token-summary__row-value">{row.value}</span>
                    <span className="token-summary__row-detail">{row.detail}</span>
                  </div>
                ))}
              </div>
            </div>
            {tokenUsage.custom && (
              <div className="token-summary__row token-summary__row--total">
                <span className="token-summary__row-label">Total</span>
                <span className="token-summary__row-value">
                  {formatTokenCount(tokenUsage.custom.totalTokens)}
                </span>
                <span className="token-summary__row-detail">provider estimate</span>
              </div>
            )}
          </div>
        ) : (
          <div className="token-summary__empty">Custom estimator did not run for this log.</div>
        )}
      </div>
    </div>
  );
}
