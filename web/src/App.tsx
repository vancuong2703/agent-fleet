import { useEffect, useMemo, useRef, useState } from 'react';
import type { Run } from '../../shared/types.js';
import { api, type DiffResult } from './api.js';
import { BriefView } from './components/BriefView.js';
import { ComparePage } from './components/ComparePage.js';
import { Dashboard } from './components/Dashboard.js';
import { TerminalPage } from './components/TerminalPage.js';
import { useCliWorkspace } from './cli-workspace.js';
import { DiffView } from './components/DiffView.js';
import { FleetMark, Icon } from './components/Icon.js';
import { Inspector, UsagePage } from './components/Inspector.js';
import { LogView } from './components/LogView.js';
import { ResizeHandle } from './components/ResizeHandle.js';
import { Sidebar } from './components/Sidebar.js';
import { TaskActions } from './components/TaskActions.js';
import { TaskComposer } from './components/TaskComposer.js';
import { TaskHeader } from './components/TaskHeader.js';
import { isDesktop } from './desktop.js';
import { useWorkspaceLayout } from './layout.js';
import { useObservability } from './observability.js';
import { taskCounts, useFleet } from './store.js';
import { useTheme, type ThemePreference } from './theme.js';

const EMPTY_RUNS: Run[] = [];
type View = 'dashboard' | 'terminal' | 'tasks' | 'compare' | 'usage';
type Tab = 'log' | 'diff' | 'brief';

const themeOptions: Array<{ value: ThemePreference; icon: 'sun' | 'moon' | 'system'; label: string }> = [
  { value: 'light', icon: 'sun', label: 'Giao diện sáng' },
  { value: 'dark', icon: 'moon', label: 'Giao diện tối' },
  { value: 'system', icon: 'system', label: 'Theo hệ thống' },
];

export function App() {
  const { state, connected, error, loadEvents } = useFleet();
  const { theme, setTheme } = useTheme();
  const { layout, updateLayout } = useWorkspaceLayout();
  const [view, setView] = useState<View>('dashboard');
  const cli = useCliWorkspace(() => setView('terminal'));
  const [tab, setTab] = useState<Tab>('log');
  const [search, setSearch] = useState('');
  const [composer, setComposer] = useState(false);
  const [showInspector, setShowInspector] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { plans, tasks } = state;
  const counts = useMemo(() => taskCounts(tasks), [tasks]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
  const plan = plans.find((entry) => entry.id === selectedTask?.planId) ?? null;
  const runs = selectedTask ? state.runsByTask[selectedTask.id] ?? EMPTY_RUNS : EMPTY_RUNS;
  const latestRun = runs.at(-1) ?? null;
  const selectedRunId = selectedTask && runs.some((run) => run.id === selectedRuns[selectedTask.id]) ? selectedRuns[selectedTask.id]! : latestRun?.id ?? null;
  const events = selectedRunId ? state.eventsByRun[selectedRunId] ?? [] : [];
  const observability = useObservability(view === 'tasks' ? plan?.id : undefined);

  useEffect(() => { if (selectedRunId) loadEvents(selectedRunId); }, [selectedRunId, loadEvents]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, []);

  const taskId = selectedTask?.id ?? null;
  const taskStatus = selectedTask?.status ?? null;
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setDiff(null); setDiffError(null);
    if (!taskId) return;
    const refresh = async () => {
      try { const result = await api.diff(taskId); if (!cancelled) { setDiff(result); setDiffError(null); } }
      catch (cause) { if (!cancelled) setDiffError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (!cancelled && tab === 'diff' && (taskStatus === 'running' || taskStatus === 'taken_over')) timer = window.setTimeout(refresh, document.hidden ? 10_000 : 3_000); }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [taskId, taskStatus, tab]);

  const viewLabel = view === 'dashboard' ? 'Bảng điều khiển' : view === 'terminal' ? 'Terminal' : view === 'tasks' ? plan?.name ?? 'Không gian làm việc' : view === 'compare' ? 'So sánh agent' : 'Tài nguyên & mức sử dụng';

  return <div className="app" style={{ ['--sidebar-width' as string]: `${layout.sidebarWidth}px`, ['--inspector-width' as string]: `${layout.inspectorWidth}px` }}>
    <aside className="workspace-sidebar">
      <div className="sidebar-brand"><div><strong>Agent Fleet</strong><span>Không gian làm việc AI</span></div><span className="version-tag">2.2.0</span></div>
      <button className="new-task-button" onClick={() => setComposer(true)}><Icon name="plus" size={18} />Task mới</button>
      <nav className="workspace-nav" aria-label="Điều hướng chính">
        <button aria-label="Bảng điều khiển" className={view === 'dashboard' ? 'active' : ''} onClick={() => setView('dashboard')}><Icon name="dashboard" />Bảng điều khiển</button>
        <button aria-label="Terminal" className={view === 'terminal' ? 'active' : ''} onClick={() => setView('terminal')}><Icon name="terminal" />Terminal<span>{cli.snapshot?.terminalSessions.length??0}</span></button>
        <button aria-label="Tasks" className={view === 'tasks' ? 'active' : ''} onClick={() => setView('tasks')}><Icon name="tasks" />Công việc<span>{tasks.length}</span></button>
        <button className={view === 'compare' ? 'active' : ''} onClick={() => setView('compare')}><Icon name="compare" />So sánh agent</button>
        <button className={view === 'usage' ? 'active' : ''} onClick={() => setView('usage')}><Icon name="activity" />Tài nguyên & sử dụng</button>
      </nav>
      <div className="sidebar-divider" /><label className="sidebar-search"><Icon name="search" size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm task, dự án…" aria-label="Tìm task hoặc dự án" /><kbd>Ctrl K</kbd></label>
      <div className="sidebar-label">DỰ ÁN<span>{plans.length}</span></div>
      <Sidebar plans={plans} tasks={tasks} query={search} selectedTaskId={selectedTask?.id ?? null} onSelect={(id) => { setSelectedTaskId(id); setView('tasks'); setTab('log'); }} />
      <div className="sidebar-bottom"><span className="local-badge"><span />Local workspace</span><div className="theme-switch" role="group" aria-label="Giao diện">{themeOptions.map((option) => <button key={option.value} type="button" className="theme-btn" aria-label={option.label} title={option.label} aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}><Icon name={option.icon} size={16} /></button>)}</div></div>
    </aside>
    <ResizeHandle orientation="vertical" label="Điều chỉnh độ rộng thanh bên" value={layout.sidebarWidth} min={190} max={420} onChange={(sidebarWidth) => updateLayout({ sidebarWidth })} />
    <div className="workspace-shell">
      <header className="topbar"><div className="workspace-breadcrumb"><Icon name={view === 'dashboard' ? 'dashboard' : view === 'terminal' ? 'terminal' : view === 'compare' ? 'compare' : view === 'usage' ? 'activity' : 'folder'} size={17} /><span>{viewLabel}</span>{view === 'tasks' && plan && <span className="breadcrumb-branch">{plan.baseBranch}</span>}</div><div className="counts"><span className="count"><i className="running-dot" /><b>{counts.running}</b> đang chạy</span><span className="count"><b>{counts.waiting}</b> chờ</span></div><div className={`connection${connected ? ' on' : ''}`} title={connected ? 'Đã kết nối' : 'Mất kết nối'}><span />{connected ? 'Trực tiếp' : 'Đang kết nối lại'}</div>{view === 'tasks' && <button className={`icon-button ${showInspector ? 'selected' : ''}`} title="Thông tin workspace" aria-label="Ẩn hoặc hiện thông tin workspace" onClick={() => setShowInspector((current) => !current)}><Icon name="panel" /></button>}</header>
      {!connected && <div className="reconnect-banner">Kết nối đang được khôi phục. Dữ liệu sẽ tự đồng bộ khi kết nối trở lại.</div>}
      <div className="body">
        <div className="dashboard-host" hidden={view !== 'dashboard'}><Dashboard plans={plans} tasks={tasks} cli={cli} /></div>
        <div className="terminal-workspace-host" hidden={view !== 'terminal'}><TerminalPage cli={cli} onDashboard={()=>setView('dashboard')}/></div>
        {view === 'compare' ? <main className="main standalone"><ComparePage plans={plans} /></main> : view === 'usage' ? <main className="main standalone"><UsagePage snapshot={observability.snapshot} error={observability.error} plans={plans} tasks={tasks} onSelectTask={(id) => { setSelectedTaskId(id); setView('tasks'); setTab('log'); }} /></main> : view === 'tasks' ? <><main className="main">
          {error && <div className="banner banner-error">Không tải được dữ liệu: {error}</div>}
          {!selectedTask ? <div className="welcome"><FleetMark size={58} /><span className="eyebrow">MỘT KHÔNG GIAN CHO CÁC AGENT</span><h1>Bắt đầu một công việc mới.</h1><p>Giao việc, theo dõi tiến độ và xem thay đổi.<br />Mọi dự án nằm trong cùng một cửa sổ.</p><button className="action-btn action-primary" onClick={() => setComposer(true)}><Icon name="plus" size={17} />Tạo task đầu tiên</button><div className="welcome-agents"><span>Codex</span><span>Qoder</span><span>Antigravity</span><span>OpenCode</span></div></div> : <>
            <TaskHeader task={selectedTask} run={latestRun} />
            <TaskActions task={selectedTask} run={latestRun} baseBranch={plan?.baseBranch ?? ''} terminalHeight={layout.terminalHeight} onTerminalHeight={(terminalHeight) => updateLayout({ terminalHeight })} />
            <div className="task-tabs"><button className={`tab${tab === 'log' ? ' active' : ''}`} onClick={() => setTab('log')}>Log</button><button className={`tab${tab === 'diff' ? ' active' : ''}`} onClick={() => setTab('diff')}>Diff ({diff?.files.length ?? 0})</button><button className={`tab${tab === 'brief' ? ' active' : ''}`} onClick={() => setTab('brief')}>Brief</button><span className="task-tabs-note">{tab === 'log' ? 'Hoạt động trực tiếp' : tab === 'diff' ? 'Thay đổi trong worktree' : 'Nội dung giao việc'}</span></div>
            {tab === 'log' ? <LogView runs={runs} events={events} runId={selectedRunId} onSelectRun={(id) => setSelectedRuns((current) => ({ ...current, [selectedTask.id]: id }))} /> : tab === 'diff' ? <DiffView files={diff?.files ?? []} patch={diff?.patch ?? ''} error={diffError} taskId={selectedTask.id} /> : <BriefView runs={runs} />}
          </>}
        </main>{showInspector && <><ResizeHandle orientation="vertical" reverse label="Điều chỉnh độ rộng bảng thông tin" value={layout.inspectorWidth} min={260} max={520} onChange={(inspectorWidth) => updateLayout({ inspectorWidth })} /><Inspector snapshot={observability.snapshot} error={observability.error} task={selectedTask} run={latestRun} plan={plan} /></>}</> : null}
      </div>
      <footer className="statusbar"><span><span className={`status-led ${connected ? 'on' : ''}`} />{connected ? 'Đã đồng bộ' : 'Đang chờ kết nối'}</span><span>{isDesktop() ? 'Windows Desktop' : 'Web workspace'}<span className="statusbar-sep">·</span>{counts.done} task hoàn tất<span className="statusbar-sep">·</span>Dữ liệu lưu trên máy</span></footer>
    </div>
    {composer && <TaskComposer plans={plans} initialPlanId={plan?.id} onClose={() => setComposer(false)} onCreated={(task) => { setSelectedTaskId(task.id); setView('tasks'); setTab('log'); setComposer(false); }} />}
  </div>;
}
