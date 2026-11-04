import { useEffect, useMemo, useRef, useState } from 'react';

import type { Run, StoredEvent } from '../../../shared/types.js';
import { buildLogRows, eventText, formatClock } from '../store.js';
import { appStrings, eventKindLabel } from '../strings.js';
import { Skeleton } from './Skeleton.js';

export interface LogViewProps {
  runs: Run[];
  events: StoredEvent[];
  runId: string | null;
  onSelectRun: (runId: string) => void;
  /** True while the run's stored events are still being fetched. */
  loading?: boolean;
  /** Failed read of the run's log; the error must not be swallowed. */
  error?: string | null;
  onRetry?: () => void;
}

const BOTTOM_THRESHOLD = 24;

/**
 * Live event log: monospace, colored by kind, `raw` runs collapsed behind a
 * toggle. Autoscroll follows the tail until the user scrolls up, then pauses.
 * Raw rows are real `<button>`s so they can be toggled from the keyboard.
 */
export function LogView({ runs, events, runId, onSelectRun, loading = false, error = null, onRetry }: LogViewProps) {
  const rows = useMemo(() => buildLogRows(events), [events]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pinned, setPinned] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinned) return;
    element.scrollTop = element.scrollHeight;
  }, [rows, pinned]);

  const handleScroll = (): void => {
    const element = scrollRef.current;
    if (!element) return;
    const atBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD;
    setPinned(atBottom);
  };

  const toggle = (id: string, open: boolean): void => {
    setExpanded((current) => ({ ...current, [id]: open }));
  };

  return (
    <div className="log-view">
      {runs.length > 0 && (
        <div className="run-selector">
          {runs.map((run) => (
            <button
              key={run.id}
              type="button"
              className={`run-chip${run.id === runId ? ' active' : ''}`}
              onClick={() => onSelectRun(run.id)}
            >
              {appStrings.log.attempt(run.attempt)}
            </button>
          ))}
        </div>
      )}
      <div className="log-scroll" ref={scrollRef} onScroll={handleScroll}>
        {error !== null && (
          <div className="banner banner-error" role="alert">
            {appStrings.log.error(error)}
            {onRetry && <button type="button" className="banner-retry" onClick={onRetry}>Thử lại</button>}
          </div>
        )}
        {rows.length === 0 && loading && error === null && <Skeleton className="log-skeleton" label={appStrings.log.loading} lines={5} />}
        {rows.length === 0 && !loading && error === null && <div className="log-empty">{appStrings.log.empty}</div>}
        {rows.map((row) => {
          if (row.raw && !expanded[row.id]) {
            return (
              <button
                key={row.id}
                type="button"
                className="log-line raw-toggle"
                onClick={() => toggle(row.id, true)}
              >
                <span className="log-ts" />
                <span className="log-kind kind-raw">{appStrings.log.rawKind}</span>
                <span className="log-text">{appStrings.log.rawToggle(row.events.length)}</span>
              </button>
            );
          }
          return row.events.map((stored) => {
            const kind = stored.event.kind;
            const content = (
              <>
                <span className="log-ts">{formatClock(stored.ts)}</span>
                <span className={`log-kind kind-${kind}`}>{eventKindLabel(kind)}</span>
                <span className="log-text">{eventText(stored.event)}</span>
              </>
            );
            // A grouped raw line is clickable, so it must be a real button:
            // the previous `div role="button"` could not be reached by keyboard.
            if (row.raw) {
              return (
                <button
                  key={`${row.id}-${stored.seq}`}
                  type="button"
                  className={`log-line kind-line-${kind}`}
                  onClick={() => toggle(row.id, false)}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={`${row.id}-${stored.seq}`} className={`log-line kind-line-${kind}`}>
                {content}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
