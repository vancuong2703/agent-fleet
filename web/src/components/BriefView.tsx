import type { Run } from '../../../shared/types.js';
import { appStrings } from '../strings.js';

export interface BriefViewProps {
  runs: Run[];
}

/**
 * Original brief plus every retry note with its attempt number. Attempt 1's
 * brief is the original; later runs carry a `note` per retry.
 */
export function BriefView({ runs }: BriefViewProps) {
  const ordered = [...runs].sort((a, b) => a.attempt - b.attempt || a.id.localeCompare(b.id));
  const original = ordered[0]?.brief ?? null;
  const notes = ordered.filter(
    (run) => run.attempt > 1 && run.note !== null && run.note.trim() !== '',
  );

  if (original === null) {
    return <div className="placeholder">{appStrings.brief.empty}</div>;
  }

  return (
    <div className="brief-view">
      <section className="brief-section">
        <h3 className="brief-heading">{appStrings.brief.original}</h3>
        <pre className="brief-text">{original}</pre>
      </section>
      {notes.map((run) => (
        <section key={run.id} className="brief-section">
          <h3 className="brief-heading">{appStrings.brief.note(run.attempt)}</h3>
          <pre className="brief-text">{run.note}</pre>
        </section>
      ))}
    </div>
  );
}
