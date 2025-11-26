import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import { clamp, formatRangeLabel } from '../utils/time';

/**
 * Stateless-ish timeline brush that renders the Logfire-style slider. The parent owns
 * the current selection; this component simply translates pointer events into
 * TimeRange updates.
 *
 * The math lives entirely in "fraction" space (0..1). This keeps the brush independent
 * of the actual timestamp values – the parent just tells us the current window.
 */

export type BrushTone = 'success' | 'warning' | 'error' | 'unknown';

export type BrushPoint = {
  timestampMs: number;
  tone: BrushTone;
  color?: string;
  fileName?: string;
};

export type TimeRange = {
  start: number;
  end: number;
};

export interface TimelineBrushProps {
  logs: BrushPoint[];
  range: TimeRange;
  effectiveSelection: TimeRange;
  selectionActive: boolean;
  activeTimestamp?: number | null;
  onSelectionChange: (range: TimeRange | null) => void;
}

export default function TimelineBrush({
  logs,
  range,
  effectiveSelection,
  selectionActive,
  activeTimestamp,
  onSelectionChange,
}: TimelineBrushProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<{ start: number; current: number } | null>(null);

  const rangeLength = Math.max(range.end - range.start, 1);

  const selectionStartFraction = clamp(
    (effectiveSelection.start - range.start) / rangeLength,
    0,
    1
  );
  const selectionEndFraction = clamp(
    (effectiveSelection.end - range.start) / rangeLength,
    0,
    1
  );

  const selectionMatchesViewport =
    Math.abs(effectiveSelection.start - range.start) <= 1 &&
    Math.abs(effectiveSelection.end - range.end) <= 1;

  const displayedSelection = dragState
    ? {
        start: Math.min(dragState.start, dragState.current),
        end: Math.max(dragState.start, dragState.current),
        active: true,
      }
    : {
        start: selectionStartFraction,
        end: selectionEndFraction,
        active: selectionActive && !selectionMatchesViewport,
      };

  const fractionToTimestamp = (fraction: number): number => {
    const normalized = clamp(fraction, 0, 1);
    return range.start + normalized * rangeLength;
  };

  const pointerToFraction = (event: ReactPointerEvent<HTMLDivElement>): number => {
    if (!containerRef.current) {
      return 0;
    }
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0) {
      return 0;
    }
    const raw = (event.clientX - rect.left) / rect.width;
    return clamp(raw, 0, 1);
  };

  const finishSelection = (startFraction: number, endFraction: number) => {
    const start = fractionToTimestamp(startFraction);
    const end = fractionToTimestamp(endFraction);
    if (Math.abs(end - start) < 1_000) {
      // Treat clicks or tiny drags as "clear selection" so the entire window is visible.
      onSelectionChange(null);
    } else {
      onSelectionChange({
        start: Math.min(start, end),
        end: Math.max(start, end),
      });
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const fraction = pointerToFraction(event);
    setDragState({ start: fraction, current: fraction });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) {
      return;
    }
    event.preventDefault();
    const fraction = pointerToFraction(event);
    setDragState((previous) => (previous ? { ...previous, current: fraction } : previous));
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) {
      return;
    }
    const fraction = pointerToFraction(event);
    finishSelection(dragState.start, fraction);
    setDragState(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const cancelDrag = (event?: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragState) {
      return;
    }
    if (event) {
      const fraction = pointerToFraction(event);
      finishSelection(dragState.start, fraction);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  };

  const hasActiveMarker =
    typeof activeTimestamp === 'number' &&
    activeTimestamp >= range.start &&
    activeTimestamp <= range.end;
  const activeMarkerFraction = hasActiveMarker
    ? clamp((activeTimestamp - range.start) / rangeLength, 0, 1)
    : null;

  const MIN_FRACTION_GAP = 0.004; // ~=0.4% of track width; keeps adjacent bars readable.

  const adjustedFractions = (() => {
    if (logs.length === 0) {
      return new Map<number, number>();
    }
    const placements = logs.map((entry, index) => ({
      index,
      fraction: clamp((entry.timestampMs - range.start) / rangeLength, 0, 1),
    }));
    placements.sort((a, b) => a.fraction - b.fraction);
    for (let i = 1; i < placements.length; i += 1) {
      const prev = placements[i - 1]!;
      const current = placements[i]!;
      if (current.fraction - prev.fraction < MIN_FRACTION_GAP) {
        placements[i]!.fraction = Math.min(prev.fraction + MIN_FRACTION_GAP, 1);
      }
    }
    for (let i = placements.length - 2; i >= 0; i -= 1) {
      const next = placements[i + 1]!;
      const current = placements[i]!;
      if (next.fraction - current.fraction < MIN_FRACTION_GAP) {
        placements[i]!.fraction = Math.max(next.fraction - MIN_FRACTION_GAP, 0);
      }
    }
    const map = new Map<number, number>();
    placements.forEach(({ index, fraction }) => {
      map.set(index, fraction);
    });
    return map;
  })();

  return (
    <div className="timeline-brush-container">
      <div
        ref={containerRef}
        className="timeline-brush"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={cancelDrag}
        onPointerLeave={cancelDrag}
        onDoubleClick={() => onSelectionChange(null)}
        role="presentation"
      >
        <div className="timeline-brush__track" />
        {hasActiveMarker && activeMarkerFraction !== null && (
          <div
            className="timeline-brush__active-marker"
            style={{ left: `${activeMarkerFraction * 100}%` }}
          />
        )}
        <div
          className={`timeline-brush__selection${
            displayedSelection.active ? ' timeline-brush__selection--active' : ''
          }`}
          style={{
            left: `${displayedSelection.start * 100}%`,
            width: `${Math.max((displayedSelection.end - displayedSelection.start) * 100, 0.5)}%`,
          }}
        />
        {logs.map((entry, index) => {
          const fraction =
            adjustedFractions.get(index) ??
            clamp((entry.timestampMs - range.start) / rangeLength, 0, 1);
          const isActive =
            typeof activeTimestamp === 'number' && entry.timestampMs === activeTimestamp;
          const dotStyle: CSSProperties = { left: `${fraction * 100}%` };
          if (entry.color) {
            dotStyle.backgroundColor = entry.color;
          }
          return (
            <span
              key={`${entry.timestampMs}-${entry.tone}-${index}`}
              className={`timeline-brush__dot timeline-brush__dot--${entry.tone}${
                isActive ? ' timeline-brush__dot--active' : ''
              }`}
              style={dotStyle}
            />
          );
        })}
      </div>
      <div className="timeline-brush__axis">
        <span>{formatRangeLabel(range.start)}</span>
        <span>{formatRangeLabel(range.end)}</span>
      </div>
    </div>
  );
}
