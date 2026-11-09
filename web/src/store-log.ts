import type { FleetEvent, Run, StoredEvent } from '../../shared/types.js';

// ── formatting ──────────────────────────────────────────────────────────────

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Log line timestamp: `HH:MM:SS` in the browser's local time. */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Compact duration: `12s`, `4m 05s`, `1h 30m`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${pad2(seconds)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${pad2(minutes % 60)}m`;
}

/** Milliseconds a run has been (or was) running, given a `now`. */
export function runElapsed(run: Run, now: number): number | null {
  if (run.startedAt !== null) return Math.max(0, (run.endedAt ?? now) - run.startedAt);
  if (run.durationMs !== null) return run.durationMs;
  return null;
}

// ── log rendering ───────────────────────────────────────────────────────────

export interface LogRow {
  id: string;
  raw: boolean;
  events: StoredEvent[];
}

/**
 * Build the log rows: every normal event is one row, and each run of
 * consecutive `raw` events collapses into a single toggleable row.
 */
export function buildLogRows(events: StoredEvent[]): LogRow[] {
  const rows: LogRow[] = [];
  let raw: StoredEvent[] = [];

  const flushRaw = (): void => {
    if (raw.length === 0) return;
    const first = raw[0]!;
    const last = raw[raw.length - 1]!;
    rows.push({ id: `raw-${first.runId}-${first.seq}-${last.seq}`, raw: true, events: raw });
    raw = [];
  };

  for (const stored of events) {
    if (stored.event.kind === 'raw') {
      raw.push(stored);
    } else {
      flushRaw();
      rows.push({ id: `e-${stored.runId}-${stored.seq}`, raw: false, events: [stored] });
    }
  }
  flushRaw();
  return rows;
}

/**
 * `buildLogRows` for an events array that only grew at the end. Rows that did
 * not change keep their identity so memoized row components skip rendering; only
 * the open raw group (if any) and the new tail are rebuilt. Anything else (a
 * trimmed head, a replaced log) falls back to a full rebuild.
 */
export function extendLogRows(
  previous: { events: StoredEvent[]; rows: LogRow[] } | null,
  events: StoredEvent[],
): LogRow[] {
  const before = previous?.events;
  const grew = previous !== null && before !== undefined && before.length > 0 && events.length >= before.length
    && events[0] === before[0] && events[before.length - 1] === before[before.length - 1];
  if (!grew || previous === null) return buildLogRows(events);
  if (events.length === before!.length) return previous.rows;
  const rows = previous.rows.slice();
  let restart = before!.length;
  const last = rows[rows.length - 1];
  // A trailing raw group may continue into the new events, so it is rebuilt.
  if (last?.raw) {
    rows.pop();
    restart -= last.events.length;
  }
  return [...rows, ...buildLogRows(events.slice(restart))];
}

/** One-line summary of an event for the log's text column. */
export function eventText(event: FleetEvent): string {
  switch (event.kind) {
    case 'message':
      return event.text;
    case 'command':
      return event.exitCode === undefined ? event.cmd : `${event.cmd} (exit ${event.exitCode})`;
    case 'file_edit': {
      const stat: string[] = [];
      if (event.added !== undefined) stat.push(`+${event.added}`);
      if (event.removed !== undefined) stat.push(`-${event.removed}`);
      return stat.length > 0 ? `${event.path} ${stat.join(' ')}` : event.path;
    }
    case 'tool':
      return event.detail ? `${event.name} ${event.detail}` : event.name;
    case 'usage': {
      const parts: string[] = [];
      if (event.inputTokens !== undefined) parts.push(`in ${event.inputTokens}`);
      if (event.outputTokens !== undefined) parts.push(`out ${event.outputTokens}`);
      if (event.costUsd !== undefined) parts.push(`$${event.costUsd.toFixed(4)}`);
      if (event.credits !== undefined) parts.push(`${event.credits.toFixed(3)} credit`);
      return parts.length > 0 ? parts.join(' · ') : 'usage';
    }
    case 'model':
      return `${event.provider ? `${event.provider} / ` : ''}${event.model}${event.source === 'configured' ? ' (cấu hình)' : ''}`;
    case 'session':
      return event.id;
    case 'error':
      return event.category ? `[${event.category}] ${event.text}` : event.text;
    case 'raw':
      return event.text;
    case 'status':
      return event.note ? `${event.status} — ${event.note}` : event.status;
    case 'check':
      return `${event.cmd} ${event.passed ? '✓' : '✗'}`;
  }
}
