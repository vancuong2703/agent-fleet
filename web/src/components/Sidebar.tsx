import type { Plan, Task } from '../../../shared/types.js';
import { filterTasks, groupByRepo, statusIcon, statusLabel, type StatusFilter } from '../store.js';
import { AgentMark, Icon } from './Icon.js';

export interface SidebarProps {
  plans: Plan[];
  tasks: Task[];
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  query?: string;
  /** Topbar chip currently pressed; the rows follow it, the plan totals stay whole. */
  filter?: StatusFilter;
}

/**
 * Left rail: repos → plans → task rows, 220px wide. `filter` narrows the rows
 * (a chip press) while `query` narrows them by text; a plan with no matching row
 * disappears, but its done/total counter keeps counting every task in the plan.
 */
export function Sidebar({ plans, tasks, selectedTaskId, onSelect, query = '', filter = 'all' }: SidebarProps) {
  const needle = query.trim().toLocaleLowerCase();
  const allowed = new Set(filterTasks(tasks, filter).map((task) => task.id));
  const groups = groupByRepo(plans, tasks)
    .map((group) => ({
      ...group,
      plans: group.plans
        .map((entry) => ({
          ...entry,
          tasks: entry.tasks.filter((task) => allowed.has(task.id)
            && (!needle || `${task.title} ${task.agent} ${task.id}`.toLocaleLowerCase().includes(needle))),
        }))
        .filter((entry) => entry.tasks.length > 0
          || (!needle && filter === 'all')),
    }))
    .filter((group) => group.plans.length > 0);

  if (groups.length === 0) {
    return (
      <aside className="sidebar">
        <p className="muted sidebar-empty">{emptyCopy(needle, filter)}</p>
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
                        <span className="task-row-agent"><AgentMark agent={task.agent} /></span>
                        <span className="task-row-title">{task.title}</span>
                        <span
                          className={`status-icon status-${task.status}`}
                          title={statusLabel(task.status)}
                          role="img"
                          aria-label={statusLabel(task.status)}
                        >
                          <Icon name={statusIcon(task.status)} size={14} />
                        </span>
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

function emptyCopy(needle: string, filter: StatusFilter): string {
  if (needle) return 'Không tìm thấy task phù hợp.';
  if (filter === 'running') return 'Không có task nào đang chạy.';
  if (filter === 'waiting') return 'Không có task nào đang chờ.';
  if (filter === 'failed') return 'Không có task nào lỗi.';
  return 'Chưa có dự án. Tạo task để bắt đầu.';
}
