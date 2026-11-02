import { useEffect, useState } from 'react';

import type { Run, Task } from '../../../shared/types.js';
import { formatElapsed, runElapsed, statusLabel } from '../store.js';

export interface TaskHeaderProps {
  task: Task;
  run: Run | null;
}

/** Re-render every second while a run is live so the elapsed time ticks. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Selected task: title, live status badge and the agent/attempt/branch meta line. */
export function TaskHeader({ task, run }: TaskHeaderProps) {
  const live = task.status === 'running' || task.status === 'taken_over';
  const now = useNow(live);
  const elapsed = run ? runElapsed(run, now) : null;

  return (
    <header className="task-header">
      <div className="task-header-top">
        <h2 className="task-header-title">{task.title}</h2>
        <span className={`status-badge status-${task.status}`}>
          {statusLabel(task.status)}
          {elapsed !== null && <span className="status-elapsed"> · {formatElapsed(elapsed)}</span>}
        </span>
      </div>
      <div className="task-meta">
        <span>{task.agent}</span>
        <span className="dot">·</span>
        <span>lần thử {run?.attempt ?? 1}</span>
        <span className="dot">·</span>
        <span className="branch" title={task.branch}>
          {task.branch}
        </span>
      </div>
    </header>
  );
}
