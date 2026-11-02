import { useEffect, useMemo, useRef, useState } from 'react';

import type { Run, StoredEvent } from '../../../shared/types.js';
import { buildLogRows, eventText, formatClock } from '../store.js';

export interface LogViewProps {
  runs: Run[];
  events: StoredEvent[];
  runId: string | null;
  onSelectRun: (runId: string) => void;
}

const BOTTOM_THRESHOLD = 24;

/**
 * Live event log: monospace, colored by kind, `raw` runs collapsed behind a
 * toggle. Autoscroll follows the tail until the user scrolls up, then pauses.
 */
export function LogView({ runs, events, runId, onSelectRun }: LogViewProps) {
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
              lần {run.attempt}
            </button>
          ))}
        </div>
      )}
      <div className="log-scroll" ref={scrollRef} onScroll={handleScroll}>
        {rows.length === 0 && <div className="log-empty">Chưa có sự kiện.</div>}
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
                <span className="log-kind kind-raw">raw</span>
                <span className="log-text">... {row.events.length} dòng raw</span>
              </button>
            );
          }
          return row.events.map((stored) => {
            const kind = stored.event.kind;
            const raw = row.raw;
            return (
              <div
                key={`${row.id}-${stored.seq}`}
                className={`log-line kind-line-${kind}`}
                onClick={raw ? () => toggle(row.id, false) : undefined}
                role={raw ? 'button' : undefined}
              >
                <span className="log-ts">{formatClock(stored.ts)}</span>
                <span className={`log-kind kind-${kind}`}>{kind}</span>
                <span className="log-text">{eventText(stored.event)}</span>
              </div>
            );
          });
        })}
      </div>
    </div>
  );
}
