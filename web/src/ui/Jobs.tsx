import { JobCheck } from './JobCheck.js';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Run, Task, TaskStatus } from '../../../shared/types.js';
import type { ObservabilitySnapshot, RunObservation } from '../../../shared/observability.js';
import { BriefView } from '../components/BriefView.js';
import { DiffView } from '../components/DiffView.js';
import { LogView } from '../components/LogView.js';
import { TaskActions } from '../components/TaskActions.js';
import { Icon } from '../components/Icon.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { usePaneSize } from '../components/usePaneSize.js';
import { copyText, errorMessage, openLocation, isDesktop } from '../desktop.js';
import { progressOf, progressText } from '../stuck.js';
import { useTaskDiff, type FleetState } from '../store.js';
import { Logo, Notice } from './Common.js';
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

export function Status({ task }: { task: Task }) {
  const { t } = useLanguage();
  const label = task.status === 'done' ? t('Review', 'Chờ duyệt') : task.status === 'merged' ? t('Done', 'Đã merge') : task.status === 'running' ? t('Running', 'Đang chạy') : task.status === 'queued' ? t('Queued', 'Đang chờ') : task.status === 'taken_over' ? t('Waiting', 'Tiếp quản') : task.status === 'failed' ? t('Failed', 'Lỗi') : task.status;
  return <span className={`badge ${['running', 'merged'].includes(task.status) ? 'ok' : task.status === 'done' || task.status === 'taken_over' ? 'warn' : ['failed', 'timeout'].includes(task.status) ? 'bad' : 'plain'}`}>{label}</span>;
}

interface JobRowProps {
  entry: Task;
  planName: string | undefined;
  latest: Run | undefined;
  selected: boolean;
  /** File count, known only for the selected task. */
  files: number | null;
  stalled: boolean;
  runError: string | undefined;
  onSelect: (id: string) => void;
}

/**
 * One row of the job list. Memoized: polling and streamed events re-render the
 * page often, and a row only needs to redraw when one of its own props changed.
 */
const JobRow = memo(function JobRow({ entry, planName, latest, selected, files, stalled, runError, onSelect }: JobRowProps) {
  const { t } = useLanguage();
  const select = () => onSelect(entry.id);
  return <tr className={selected ? 'sel' : ''} onClick={select}>
    <td>
      <button className="rowbtn task-row" aria-pressed={selected} onClick={select}><span className="task-row-title">{entry.title}</span></button>
      <span className="cellsub" title={entry.branch}>{entry.id} · {planName ?? '—'} · {latest?.durationMs ? duration(latest.durationMs) : clock(entry.createdAt)}</span>
    </td>
    <td><span className="agentchip"><Logo agent={entry.agent} small />{agentNames[entry.agent]}</span></td>
    <td className="status-cell">
      <Status task={entry} />
      {stalled && <span className="row-flag warn" role="img" aria-label={t('No progress for over 2 minutes', 'Không có tiến triển hơn 2 phút')} title={t('No progress for over 2 minutes', 'Không có tiến triển hơn 2 phút')}><Icon name="warning" size={13} /></span>}
      {runError !== undefined && <span className="row-flag bad" role="img" aria-label={t('Run history could not be loaded', 'Không tải được lịch sử chạy')} title={`${t('Run history could not be loaded', 'Không tải được lịch sử chạy')}: ${runError}`}><Icon name="warning" size={13} /></span>}
    </td>
    <td className="num">{files ?? '—'}</td>
  </tr>;
});

/** One line for a running job: the current step and how long ago it last made progress. */
function ProgressLine({ row }: { row: RunObservation | undefined }) {
  const { t } = useLanguage();
  const progress = progressOf(row?.silentForMs);
  const stalled = progress.kind === 'stalled';
  const step = row?.currentActivity?.trim();
  return <p className={`progress-line${stalled ? ' stalled' : ''}`}>
    {stalled && <Icon name="warning" size={13} />}
    {step ? <><span className="progress-step" title={step}>{step}</span><span className="progress-sep" aria-hidden="true">·</span></> : null}
    <span className="progress-when">{progressText(progress, t)}</span>
  </p>;
}

export interface JobsProps {
  state: FleetState; selectedId: string | null; onSelect: (id: string) => void; onCreate: () => void;
  loaded: boolean; error: string | null; reload: () => void;
  loadEvents: (id: string, force?: boolean) => void;
  logState: (id: string | null) => { loaded: boolean; error: string | null };
  snapshot: ObservabilitySnapshot | null;
  /** Server fault code behind `error`, for example `db_corrupt`. */
  errorCode?: string | null;
  /** Tasks whose run history failed to load, with the reason. */
  runErrors?: Record<string, string>;
  retryRuns?: (taskId: string) => void;
}
const NO_ERRORS: Record<string, string> = {};

const JOBS_LIST_MIN = 280;
const JOBS_DETAIL_MIN = 360;
const JOBS_DIVIDER = 14;

export function Jobs({ state, selectedId, onSelect, onCreate, loaded, error, reload, loadEvents, logState, snapshot, errorCode = null, runErrors = NO_ERRORS, retryRuns }: JobsProps) {
  const { t } = useLanguage(); const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'log' | 'diff' | 'brief'>('log'); const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  // Expanded ("zoom"): the list narrows to a title + status strip, and the page
  // head, filters and job meta/actions hide so the log pane gets the full height.
  const [zoom, setZoom] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Draggable list | detail divider; the default stays the stylesheet's 1.18fr / 1fr until the user drags.
  const listPane = usePaneSize({ storageKey: 'fleet.jobs.listWidth', min: JOBS_LIST_MIN, max: total => total - JOBS_DIVIDER - JOBS_DETAIL_MIN, fallback: total => Math.round((total - JOBS_DIVIDER) * 1.18 / 2.18) });
  const panesRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef<{ list: number; pane: number; tab: string } | null>(null);

  const tasks = useMemo(() => [...state.tasks].sort((a, b) => b.createdAt - a.createdAt), [state.tasks]);
  const planById = useMemo(() => new Map(state.plans.map(plan => [plan.id, plan])), [state.plans]);
  const visible = useMemo(() => {
    const match = statuses.find(item => item.id === filter)?.match ?? statuses[0]!.match;
    const needle = query.trim().toLowerCase();
    return tasks.filter(task => match(task.status) && (needle === '' || `${task.title} ${task.id} ${planById.get(task.planId)?.name ?? ''}`.toLowerCase().includes(needle)));
  }, [tasks, planById, filter, query]);
  const observationByRun = useMemo(() => new Map((snapshot?.runs ?? []).map(row => [row.runId, row])), [snapshot]);

  const task = tasks.find(task => task.id === selectedId) ?? tasks[0] ?? null;
  const plan = task ? planById.get(task.planId) : undefined;
  const runs = task ? state.runsByTask[task.id] ?? EMPTY_RUNS : EMPTY_RUNS; const latest = runs.at(-1) ?? null;
  const selectedRun = task ? runs.find(run => run.id === selectedRuns[task.id]) ?? latest : null;
  const log = logState(selectedRun?.id ?? null); const events = selectedRun ? state.eventsByRun[selectedRun.id] ?? [] : [];
  // The patch is read once per selected task (the tab count needs it) and only
  // polled while the Changes tab is open.
  const diff = useTaskDiff(task?.id ?? null, task?.status ?? null, tab === 'diff');
  const selectedTaskId = task?.id ?? null;
  const diffFileCount = diff.loaded ? diff.diff?.files.length ?? null : null;
  const select = useCallback((id: string) => onSelect(id), [onSelect]);

  useEffect(() => { if (selectedRun) loadEvents(selectedRun.id); }, [selectedRun?.id, loadEvents]);
  useEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => { if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName) || event.ctrlKey || event.altKey || event.metaKey || document.querySelector('[role="dialog"]')) return; const index = ['1', '2', '3'].indexOf(event.key); if (index >= 0) { event.preventDefault(); setTab((['log', 'diff', 'brief'] as const)[index]); } };
    document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  }, []);

  // The scrollers the zoom must not disturb: the job list and the open tab's pane.
  const paneScroller = () => panesRef.current?.querySelector<HTMLElement>('.log-scroll, .diff-pane, .pane.scroll') ?? null;
  const toggleZoom = () => {
    if (!zoom) savedScroll.current = { list: listRef.current?.scrollTop ?? 0, pane: paneScroller()?.scrollTop ?? 0, tab };
    setZoom(value => !value);
  };
  // Shrinking restores the exact positions the list and the pane had before expanding.
  useLayoutEffect(() => {
    if (zoom || savedScroll.current === null) return;
    const saved = savedScroll.current; savedScroll.current = null;
    if (listRef.current) listRef.current.scrollTop = saved.list;
    const pane = paneScroller();
    if (pane && saved.tab === tab) pane.scrollTop = saved.pane;
  }, [zoom]);
  useEffect(() => {
    if (!zoom) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape belongs to dialogs, menus and the terminal first.
      if (document.querySelector('[role="dialog"],[role="menu"]') || (event.target as HTMLElement | null)?.closest?.('.xterm,.terminal-panel')) return;
      toggleZoom();
    };
    document.addEventListener('keydown', handler); return () => document.removeEventListener('keydown', handler);
  });

  const tabs = [{ id: 'log', label: t('Log', 'Nhật ký') }, { id: 'diff', label: `${t('Changes', 'Thay đổi')}${diff.loaded ? ` (${diff.diff?.files.length ?? 0})` : ''}` }, { id: 'brief', label: t('Request', 'Yêu cầu') }] as const;
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => { const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null; if (next !== null) { event.preventDefault(); setTab(tabs[next].id); document.getElementById(`task-tab-${tabs[next].id}`)?.focus(); } };
  const pathAction = async () => { if (!task) return; setLocationError(null); try { if (isDesktop()) await openLocation({ taskId: task.id, action: 'open' }); else await copyText(task.worktreePath); } catch (cause) { setLocationError(errorMessage(cause)); } };

  const taskRunError = task ? runErrors[task.id] : undefined;
  const taskObservation = latest ? observationByRun.get(latest.id) : undefined;
  const pageError = error && errorCode === 'db_corrupt' ? `${error} ${t('Run `fleet db check` to inspect the database.', 'Chạy `fleet db check` để kiểm tra cơ sở dữ liệu.')}` : error;
  const countText = loaded ? `${visible.length} / ${tasks.length}` : '— / —';

  return <div className={`wrap jobs-page${zoom ? ' is-zoom' : ''}`} data-page="tasks">
    <header className="head jobs-head">
      <div className="head-title-block">
        <div className="eyebrow">{t('Task execution', 'Điều phối công việc')}</div>
        <h1 className="title sm">{t('Jobs', 'Công việc')}</h1>
      </div>
      <div className="filters jbar" role="group" aria-label={t('Job status', 'Trạng thái công việc')}>{statuses.map(status => <button className="chip" key={status.id} aria-pressed={filter === status.id} onClick={() => setFilter(status.id)}>{t(status.en, status.vi)}</button>)}<span className="count">{countText} {t('jobs', 'công việc')}</span></div>
      <label className="job-search"><Icon name="search" size={14} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Find a job', 'Tìm công việc hoặc dự án')} placeholder={t('Search jobs…', 'Tìm công việc…')} /></label>
      <button className="btn primary" onClick={onCreate}><Icon name="plus" size={14} />{t('New job', 'Công việc mới')}</button>
    </header>
    {pageError && <Notice message={pageError} error onRetry={reload} />}
    <div className={`split jobs-split${zoom ? ' zoom' : ''}`} ref={listPane.containerRef} style={listPane.custom !== null ? { '--jobs-list-width': `${listPane.custom}px` } as CSSProperties : undefined}><section className="panel list" aria-label={t('Job list', 'Danh sách công việc')}><div className="tablewrap" ref={listRef}><table className="table jobs"><thead><tr><th>{t('Title', 'Tiêu đề')}</th><th>Agent</th><th>{t('Status', 'Trạng thái')}</th><th className="num">{t('Files', 'Tệp')}</th></tr></thead><tbody className="rows">
      {visible.map(entry => { const entryLatest = state.runsByTask[entry.id]?.at(-1); const stalled = entry.status === 'running' && entryLatest !== undefined && progressOf(observationByRun.get(entryLatest.id)?.silentForMs).kind === 'stalled'; return <JobRow key={entry.id} entry={entry} planName={planById.get(entry.planId)?.name} latest={entryLatest} selected={entry.id === task?.id} files={entry.id === selectedTaskId ? diffFileCount : null} stalled={stalled} runError={runErrors[entry.id]} onSelect={select} />; })}
    </tbody></table>{!loaded && !error && <p className="empty" role="status">{t('Loading jobs…', 'Đang tải công việc…')}</p>}{loaded && !visible.length && <div className="empty"><h3>{tasks.length ? t('No matching jobs', 'Không có công việc phù hợp') : t('Start a new job', 'Bắt đầu công việc mới')}</h3><p>{t('Choose a repo → Write a request → Review the changes', 'Chọn repo → Viết yêu cầu → Duyệt thay đổi')}</p><button className="btn" onClick={tasks.length ? () => { setFilter('all'); setQuery(''); } : onCreate}>{tasks.length ? t('Clear filters', 'Xoá bộ lọc') : t('Create first job', 'Tạo công việc đầu tiên')}</button></div>}</div></section>
    {!zoom && <ResizeHandle className="jobs-divider" orientation="vertical" label={t('Resize the job list', 'Điều chỉnh độ rộng danh sách công việc')} value={listPane.size} min={listPane.min} max={listPane.max} onChange={listPane.setSize} onReset={listPane.reset} />}
    <section className="panel detail" aria-label={t('Selected job', 'Công việc đã chọn')}>{task ? <>
      <div className="detail-top">
        <h4>{t('Selected job', 'Công việc đã chọn')}<span className="spacer">{task.title}</span></h4>
        <p className="cellsub jobmeta">{task.id} · {task.status.toUpperCase()} · {agentNames[task.agent]} · <span title={task.branch}>{plan?.name}/{plan?.baseBranch}</span></p>
        <div className="detail-title"><h2>{task.title}</h2><Status task={task} /></div>
        {taskRunError !== undefined && <div className="banner banner-warn run-history-warning" role="alert"><Icon name="warning" size={14} /><span>{t('Run history could not be loaded', 'Không tải được lịch sử chạy')}: {taskRunError}</span>{retryRuns && <button type="button" className="banner-retry" onClick={() => retryRuns(task.id)}>{t('Retry', 'Thử lại')}</button>}</div>}
        {task.status === 'running' && <ProgressLine row={taskObservation} />}
        <JobCheck run={latest} /><TaskActions key={task.id} task={task} run={latest} baseBranch={plan?.baseBranch ?? ''} terminalHeight={320} onTerminalHeight={() => {}} />
      </div>
      <div className="task-tabs-row"><div className="jtabs" role="tablist" aria-label={t('Job details', 'Chi tiết công việc')}>{tabs.map((item, index) => <button className="stab" id={`task-tab-${item.id}`} key={item.id} role="tab" tabIndex={tab === item.id ? 0 : -1} aria-selected={tab === item.id} aria-controls="task-tab-panel" onClick={() => setTab(item.id)} onKeyDown={event => moveTab(event, index)}>{item.label}</button>)}</div><button type="button" className="btn ghost sm zoom-toggle" aria-pressed={zoom} aria-label={zoom ? t('Shrink the log', 'Thu nhỏ nhật ký') : t('Expand the log', 'Phóng to nhật ký')} title={zoom ? t('Back to the two-column split (Esc)', 'Trở lại chia hai cột (Esc)') : t('Hide the header and widen the log', 'Ẩn đầu trang và mở rộng nhật ký')} onClick={toggleZoom}><Icon name={zoom ? 'minimize' : 'maximize'} size={13} /><span>{zoom ? t('Shrink', 'Thu nhỏ') : t('Expand', 'Phóng to')}</span></button></div>
      <div className="panes" ref={panesRef}><div className={`pane ${tab === 'log' ? 'logbox' : tab === 'diff' ? 'diffbox' : 'scroll'}`} id="task-tab-panel" role="tabpanel" aria-labelledby={`task-tab-${tab}`}>{tab === 'log' ? <LogView runs={runs} events={events} runId={selectedRun?.id ?? null} loading={!log.loaded} error={log.error} onRetry={() => selectedRun && loadEvents(selectedRun.id, true)} onSelectRun={id => setSelectedRuns(current => ({ ...current, [task.id]: id }))} /> : tab === 'diff' ? <DiffView key={task.id} files={diff.diff?.files ?? []} patch={diff.diff?.patch ?? ''} loading={!diff.loaded} error={diff.error} onRetry={diff.reload} taskId={task.id} worktreePath={task.worktreePath} /> : <><BriefView runs={runs} /><div className="request-location"><code>{task.worktreePath}</code><button className="btn" onClick={() => void pathAction()}><Icon name="folder" size={14} />{isDesktop() ? t('Open worktree', 'Mở worktree') : t('Copy worktree path', 'Sao chép đường dẫn worktree')}</button>{locationError && <p role="alert">{locationError}</p>}</div>{snapshot?.runs.find(row => row.taskId === task.id)?.models.map(model => <code className="model-note" key={model.name}>{model.name} · {model.source}</code>)}</>}</div></div>
    </> : <><h4>{t('Selected job', 'Công việc đã chọn')}<span className="spacer">—</span></h4><div className="empty">{t('Select a job to see its log, changes and request.', 'Chọn công việc để xem nhật ký, thay đổi và yêu cầu.')}</div></>}</section></div>
  </div>;
}
