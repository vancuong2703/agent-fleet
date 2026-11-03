import { useEffect, useState } from 'react';

import type { Run, Task } from '../../../shared/types.js';
import { runDiagnostic } from '../../../shared/run-diagnostics.js';
import { formatElapsed, runElapsed, statusLabel } from '../store.js';
import { AgentMark } from './Icon.js';

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
  const diagnostic = runDiagnostic(run);

  return (
    <header className="task-header">
      <div className="task-header-top">
        <AgentMark agent={task.agent} />
        <h2 className="task-header-title">{task.title}</h2>
        <span className={`status-badge status-${task.status}`}>
          {statusLabel(task.status)}
          {elapsed !== null && <span className="status-elapsed"> · {formatElapsed(elapsed)}</span>}
        </span>
      </div>
      <div className="task-meta">
        <span className="agent-name">{task.agent}</span>
        <span className="dot">·</span>
        <span>lần thử {run?.attempt ?? 1}</span>
        <span className="dot">·</span>
        <span className="branch" title={task.branch}>
          {task.branch}
        </span>
      </div>
      {run?.startedAt != null && <div className="task-timing"><time dateTime={new Date(run.startedAt).toISOString()}>Bắt đầu {new Date(run.startedAt).toLocaleString('vi-VN')}</time>{run.endedAt != null && <><span>·</span><time dateTime={new Date(run.endedAt).toISOString()}>Kết thúc {new Date(run.endedAt).toLocaleTimeString('vi-VN')}</time></>}{run.pid != null && run.status === 'running' && <><span>·</span><span>PID {run.pid}</span></>}</div>}
      {run?.checkPassed != null && (
        <p className={`task-check ${run.checkPassed ? 'check-passed' : 'check-failed'}`}>
          Kiểm tra: {run.checkPassed ? 'PASS' : 'FAIL'}
        </p>
      )}
      {diagnostic && <p className="banner banner-error" role="alert">{diagnostic}</p>}
    </header>
  );
}
