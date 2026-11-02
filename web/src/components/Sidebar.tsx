import type { Plan, Task } from '../../../shared/types.js';
import { groupByRepo, statusIcon, statusLabel } from '../store.js';

export interface SidebarProps {
  plans: Plan[];
  tasks: Task[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
}

/** Left rail: repos → plans → task rows, 220px wide. */
export function Sidebar({ plans, tasks, selectedTaskId, onSelect }: SidebarProps) {
  const groups = groupByRepo(plans, tasks);

  if (groups.length === 0) {
    return (
      <aside className="sidebar">
        <p className="muted sidebar-empty">Chưa có plan nào.</p>
      </aside>
    );
  }

  return (
    <aside className="sidebar">
      {groups.map((group) => (
        <section key={group.repoPath} className="repo-group">
          <div className="repo-header" title={group.repoPath}>
            {group.name}
          </div>
          {group.plans.map((planGroup) => {
            const percent =
              planGroup.total > 0
                ? Math.round((planGroup.done / planGroup.total) * 100)
                : 0;
            return (
              <div key={planGroup.plan.id} className="plan-group">
                <div className="plan-header" title={planGroup.plan.name}>
                  <span className="plan-name">{planGroup.plan.name}</span>
                  <span className="plan-count">
                    {planGroup.done}/{planGroup.total}
                  </span>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={percent}>
                  <div className="progress-fill" style={{ width: `${percent}%` }} />
                </div>
                <ul className="task-list">
                  {planGroup.tasks.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        className={`task-row${task.id === selectedTaskId ? ' selected' : ''}`}
                        onClick={() => onSelect(task.id)}
                        title={task.title}
                      >
                        <span
                          className={`status-icon status-${task.status}`}
                          title={statusLabel(task.status)}
                        >
                          {statusIcon(task.status)}
                        </span>
                        <span className="task-row-title">{task.title}</span>
                        <span className="task-row-agent">{task.agent}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
    </aside>
  );
}
