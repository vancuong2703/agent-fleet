import { JobCheck } from './JobCheck.js';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Run, Task, TaskStatus } from '../../../shared/types.js';
import type { ObservabilitySnapshot } from '../../../shared/observability.js';
import { BriefView } from '../components/BriefView.js';
import { DiffView } from '../components/DiffView.js';
import { LogView } from '../components/LogView.js';
import { TaskActions } from '../components/TaskActions.js';
import { Icon } from '../components/Icon.js';
import { copyText, openLocation, isDesktop } from '../desktop.js';
import { useTaskDiff, type FleetState } from '../store.js';
import { Logo, Notice, PageHead } from './Common.js';
import { useLanguage } from './language.js';
import { agentNames, clock, duration } from './model.js';

const EMPTY_RUNS: Run[] = [];
const statuses: Array<{ id: string; en: string; vi: string; match: (status: TaskStatus) => boolean }> = [
  { id: 'all', en: 'All', vi: 'Tất cả', match: () => true },
  { id: 'running', en: 'Running', vi: 'Đang chạy', match: status => status === 'running' },
  { id: 'waiting', en: 'Waiting', vi: 'Chờ thao tác', match: status => status === 'taken_over' },
  { id: 'queued', en: 'Queued', vi: 'Đang chờ', match: status => status === 'queued' },
  { id: 'review', en: 'Review', vi: 'Chờ duyệt', match: status => status === 'done' },
  { id: 'done', en: 'Done', vi: 'Hoàn tất', match: status => status === 'merged' },
  { id: 'failed', en: 'Failed', vi: 'Lỗi', match: status => ['failed', 'timeout', 'interrupted'].includes(status) },
];
export function Status({ task }: { task: Task }) { const { t } = useLanguage(); const label = task.status === 'done' ? t('Review', 'Chờ duyệt') : task.status === 'merged' ? t('Done', 'Đã merge') : task.status === 'running' ? t('Running', 'Đang chạy') : task.status === 'queued' ? t('Queued', 'Đang chờ') : task.status === 'taken_over' ? t('Waiting', 'Tiếp quản') : task.status === 'failed' ? t('Failed', 'Lỗi') : task.status; return <span className={`badge ${['running', 'merged'].includes(task.status) ? 'ok' : task.status === 'done' || task.status === 'taken_over' ? 'warn' : ['failed', 'timeout'].includes(task.status) ? 'bad' : 'plain'}`}>{label}</span>; }

export interface JobsProps {
  state: FleetState; selectedId: string | null; onSelect: (id: string) => void; onCreate: () => void;
  loaded: boolean; error: string | null; reload: () => void;
  loadEvents: (id: string, force?: boolean) => void;
  logState: (id: string | null) => { loaded: boolean; error: string | null };
  snapshot: ObservabilitySnapshot | null;
}
export function Jobs({ state, selectedId, onSelect, onCreate, loaded, error, reload, loadEvents, logState, snapshot }: JobsProps) {
  const { t } = useLanguage(); const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'log' | 'diff' | 'brief'>('log'); const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  // Log zoom: the split is list | detail. Zoom narrows the list to a title +
  // status strip so the detail (and the log inside it) gets the width back.
  const [zoom, setZoom] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const tasks = useMemo(() => [...state.tasks].sort((a, b) => b.createdAt - a.createdAt), [state.tasks]);
  const visible = tasks.filter(task => (statuses.find(item => item.id === filter)?.match(task.status) ?? true) && `${task.title} ${task.id} ${state.plans.find(plan => plan.id === task.planId)?.name ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const task = tasks.find(task => task.id === selectedId) ?? tasks[0] ?? null;
  const plan = state.plans.find(plan => plan.id === task?.planId);
  const runs = task ? state.runsByTask[task.id] ?? EMPTY_RUNS : EMPTY_RUNS; const latest = runs.at(-1) ?? null;
  const selectedRun = task ? runs.find(run => run.id === selectedRuns[task.id]) ?? latest : null;
  const log = logState(selectedRun?.id ?? null); const events = selectedRun ? state.eventsByRun[selectedRun.id] ?? [] : [];
  const diff = useTaskDiff(task?.id ?? null, task?.status ?? null, true);
  useEffect(() => { if (selectedRun) loadEvents(selectedRun.id); }, [selectedRun?.id, loadEvents]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName) || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('[role="dialog"]')) return; const index = ['1', '2', '3'].indexOf(event.key); if (index >= 0) { event.preventDefault(); setTab((['log', 'diff', 'brief'] as const)[index]); } };
    document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  }, []);
  const tabs = [{ id: 'log', label: t('Log', 'Nhật ký') }, { id: 'diff', label: `${t('Changes', 'Thay đổi')}${diff.loaded ? ` (${diff.diff?.files.length ?? 0})` : ''}` }, { id: 'brief', label: t('Request', 'Yêu cầu') }] as const;
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => { const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null; if (next !== null) { event.preventDefault(); setTab(tabs[next].id); document.getElementById(`task-tab-${tabs[next].id}`)?.focus(); } };
  const pathAction = async () => { if (!task) return; setLocationError(null); try { if (isDesktop()) await openLocation({ taskId: task.id, action: 'open' }); else await copyText(task.worktreePath); } catch (cause) { setLocationError(String(cause)); } };
  return <div className="wrap jobs-page" data-page="tasks"><PageHead title="JO" accent="BS" label={t('Jobs', 'Công việc')} eyebrow={t('Work queue', 'Hàng đợi công việc')} actions={<><span className="stamp">{tasks.length} {t('jobs', 'công việc')}</span><button className="btn primary" onClick={onCreate}><Icon name="plus" size={14} />{t('New job', 'Công việc mới')}</button></>} />
    {error && <Notice message={error} error onRetry={reload} />}
    <div className="filters jbar" role="group" aria-label={t('Job status', 'Trạng thái công việc')}>{statuses.map(status => <button className="chip" key={status.id} aria-pressed={filter === status.id} onClick={() => setFilter(status.id)}>{t(status.en, status.vi)}</button>)}<span className="count">{visible.length} / {tasks.length} {t('jobs', 'công việc')}</span><label className="job-search"><Icon name="search" size={14} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Find a job', 'Tìm công việc hoặc dự án')} placeholder={t('Search jobs…', 'Tìm công việc…')} /></label></div>
    <div className={`split fill${zoom ? ' zoom' : ''}`}><section className="panel list" aria-label={t('Job list', 'Danh sách công việc')}><div className="tablewrap"><table className="table jobs"><thead><tr><th>{t('Title', 'Tiêu đề')}</th><th>Agent</th><th>{t('Status', 'Trạng thái')}</th><th className="num">{t('Files', 'Tệp')}</th></tr></thead><tbody className="rows">
      {visible.map(entry => { const run = state.runsByTask[entry.id]?.at(-1); const taskPlan = state.plans.find(plan => plan.id === entry.planId); return <tr className={task?.id === entry.id ? 'sel' : ''} key={entry.id} onClick={() => onSelect(entry.id)}><td><button className="rowbtn task-row" aria-pressed={task?.id === entry.id} onClick={() => onSelect(entry.id)}><span className="task-row-title">{entry.title}</span></button><span className="cellsub" title={entry.branch}>{entry.id} · {taskPlan?.name ?? '—'} · {run?.durationMs ? duration(run.durationMs) : clock(entry.createdAt)}</span></td><td><span className="agentchip"><Logo agent={entry.agent} small />{agentNames[entry.agent]}</span></td><td><Status task={entry} /></td><td className="num">{entry.id === task?.id && diff.loaded ? diff.diff?.files.length ?? '—' : '—'}</td></tr>; })}
    </tbody></table></div>{!loaded && !error && <p className="empty" role="status">{t('Loading jobs…', 'Đang tải công việc…')}</p>}{loaded && !visible.length && <div className="empty"><h3>{tasks.length ? t('No matching jobs', 'Không có công việc phù hợp') : t('Start a new job', 'Bắt đầu công việc mới')}</h3><p>{t('Choose a repo → Write a request → Review the changes', 'Chọn repo → Viết yêu cầu → Duyệt thay đổi')}</p><button className="btn" onClick={tasks.length ? () => { setFilter('all'); setQuery(''); } : onCreate}>{tasks.length ? t('Clear filters', 'Xoá bộ lọc') : t('Create first job', 'Tạo công việc đầu tiên')}</button></div>}</section>
    <section className="panel detail" aria-label={t('Selected job', 'Công việc đã chọn')}><h4>{t('Selected job', 'Công việc đã chọn')}<span className="spacer">{task?.title ?? '—'}</span></h4>{task ? <><p className="cellsub jobmeta">{task.id} · {task.status.toUpperCase()} · {agentNames[task.agent]} · <span title={task.branch}>{plan?.name}/{plan?.baseBranch}</span></p><div className="detail-title"><h2>{task.title}</h2><Status task={task} /></div><JobCheck run={latest} /><TaskActions key={task.id} task={task} run={latest} baseBranch={plan?.baseBranch ?? ''} terminalHeight={320} onTerminalHeight={() => {}} /><div className="task-tabs-row"><div className="jtabs" role="tablist" aria-label={t('Job details', 'Chi tiết công việc')}>{tabs.map((item, index) => <button className="stab" id={`task-tab-${item.id}`} key={item.id} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls="task-tab-panel" onClick={() => setTab(item.id)} onKeyDown={event => moveTab(event, index)}>{item.label}</button>)}</div><button type="button" className="btn ghost sm zoom-toggle" aria-pressed={zoom} aria-label={zoom ? t('Shrink the log', 'Thu nhỏ nhật ký') : t('Expand the log', 'Phóng to nhật ký')} title={zoom ? t('Back to the two-column split', 'Trở lại chia hai cột') : t('Narrow the job list to widen the log', 'Thu nhỏ danh sách việc để mở rộng nhật ký')} onClick={() => setZoom(value => !value)}><Icon name={zoom ? 'minimize' : 'maximize'} size={13} /><span>{zoom ? t('Shrink', 'Thu nhỏ') : t('Expand', 'Phóng to')}</span></button></div><div className="panes"><div className={`pane ${tab === 'log' ? 'logbox' : ''}`} id="task-tab-panel" role="tabpanel" aria-labelledby={`task-tab-${tab}`}>{tab === 'log' ? <LogView runs={runs} events={events} runId={selectedRun?.id ?? null} loading={!log.loaded} error={log.error} onRetry={() => selectedRun && loadEvents(selectedRun.id, true)} onSelectRun={id => setSelectedRuns(current => ({ ...current, [task.id]: id }))} /> : tab === 'diff' ? <DiffView files={diff.diff?.files ?? []} patch={diff.diff?.patch ?? ''} loading={!diff.loaded} error={diff.error} onRetry={diff.reload} taskId={task.id} /> : <><BriefView runs={runs} /><div className="request-location"><code>{task.worktreePath}</code><button className="btn" onClick={() => void pathAction()}><Icon name="folder" size={14} />{isDesktop() ? t('Open worktree', 'Mở worktree') : t('Copy worktree path', 'Sao chép đường dẫn worktree')}</button>{locationError && <p role="alert">{locationError}</p>}</div>{snapshot?.runs.find(row => row.taskId === task.id)?.models.map(model => <code className="model-note" key={model.name}>{model.name} · {model.source}</code>)}</>}</div></div></> : <div className="empty">{t('Select a job to see its log, changes and request.', 'Chọn công việc để xem nhật ký, thay đổi và yêu cầu.')}</div>}</section></div>
  </div>;
}
