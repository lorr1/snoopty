import { useEffect, useMemo, useRef, useState } from 'react';
import { countTokens } from '@anthropic-ai/tokenizer';

export type ChatPreviewVariant =
  | 'system'
  | 'user'
  | 'assistant'
  | 'thinking'
  | 'tool'
  | 'tool-definition'
  | 'tool-use'
  | 'tool-return'
  | 'other';

export interface ChatPreviewSegment {
  id: string;
  role: string;
  title: string;
  subtitle?: string;
  body: string;
  variant: ChatPreviewVariant;
}

export interface ChatPreviewMetadata {
  model?: string | null;
  method?: string | null;
  path?: string | null;
  timestamp?: string | null;
}

interface ChatPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  segments: ChatPreviewSegment[];
  metadata?: ChatPreviewMetadata | null;
}

export default function ChatPreviewModal({
  isOpen,
  onClose,
  segments,
  metadata,
}: ChatPreviewModalProps): JSX.Element | null {
  const [collapsedSegments, setCollapsedSegments] = useState<Set<string>>(new Set());
  const lastSignatureRef = useRef<string | null>(null);
  const hasSegments = useMemo(() => segments.length > 0, [segments.length]);
  const segmentStats = useMemo(() => {
    const stats = new Map<string, { chars: number; tokens: number }>();
    segments.forEach((segment) => {
      const body = segment.body ?? '';
      const chars = body.length;
      let tokens = 0;
      try {
        tokens = body ? countTokens(body) : 0;
      } catch {
        tokens = 0;
      }
      stats.set(segment.id, { chars, tokens });
    });
    return stats;
  }, [segments]);

  useEffect(() => {
    if (!isOpen) {
      setCollapsedSegments(new Set());
      lastSignatureRef.current = null;
      return;
    }
    const signature = segments.map((segment) => segment.id).join('|');
    if (signature === lastSignatureRef.current) {
      return;
    }
    lastSignatureRef.current = signature;
    const next = new Set<string>();
    segments.forEach((segment) => {
      if (segment.variant === 'tool' || segment.variant.startsWith('tool-')) {
        next.add(segment.id);
      }
    });
    setCollapsedSegments(next);
  }, [isOpen, segments]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const headingId = 'chat-preview-modal-title';

  const toggleSegment = (segmentId: string) => {
    setCollapsedSegments((prev) => {
      const next = new Set(prev);
      if (next.has(segmentId)) {
        next.delete(segmentId);
      } else {
        next.add(segmentId);
      }
      return next;
    });
  };

  return (
    <div className="chat-preview-modal">
      <div className="chat-preview-modal__backdrop" onClick={onClose} aria-hidden="true" />
      <div
        className="chat-preview-modal__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <div className="chat-preview-modal__header">
          <div>
            <h3 id={headingId}>Chat Request Preview</h3>
            <div className="chat-preview-modal__meta">
              {metadata?.model && (
                <span>
                  Model <strong>{metadata.model}</strong>
                </span>
              )}
              {metadata?.method && metadata?.path && (
                <span>
                  {metadata.method} {metadata.path}
                </span>
              )}
              {metadata?.timestamp && <span>{metadata.timestamp}</span>}
            </div>
          </div>
          <button
            type="button"
            className="chat-preview-modal__close"
            onClick={onClose}
            aria-label="Close chat preview"
          >
            Close
          </button>
        </div>
        <div className="chat-preview-modal__body">
          {hasSegments ? (
            segments.map((segment) => {
              const stats = segmentStats.get(segment.id);
              const chars = stats?.chars ?? segment.body.length;
              const tokens = stats?.tokens ?? 0;
              return (
                <article
                  key={segment.id}
                  className={`chat-preview-card chat-preview-card--${segment.variant}`}
                >
                  <header className="chat-preview-card__header">
                    <div className="chat-preview-card__header-text">
                      <span className="chat-preview-card__title">{segment.title}</span>
                      {segment.subtitle && (
                        <span className="chat-preview-card__subtitle">{segment.subtitle}</span>
                      )}
                      <div className="chat-preview-card__metrics">
                        <span>{chars.toLocaleString()} chars</span>
                        <span>~{tokens.toLocaleString()} tokens</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="chat-preview-card__collapse"
                      onClick={() => toggleSegment(segment.id)}
                      aria-expanded={!collapsedSegments.has(segment.id)}
                      aria-controls={`chat-preview-body-${segment.id}`}
                    >
                      {collapsedSegments.has(segment.id) ? 'Expand' : 'Collapse'}
                    </button>
                  </header>
                  {collapsedSegments.has(segment.id) ? (
                    <div className="chat-preview-card__collapsed" id={`chat-preview-body-${segment.id}`}>
                      Collapsed · {chars.toLocaleString()} chars · ~{tokens.toLocaleString()} tokens hidden
                    </div>
                  ) : (
                    <pre
                      className="chat-preview-card__content"
                      id={`chat-preview-body-${segment.id}`}
                    >
                      {segment.body}
                    </pre>
                  )}
                </article>
              );
            })
          ) : (
            <div className="chat-preview-modal__empty">
              This request does not include any chat-style content.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
