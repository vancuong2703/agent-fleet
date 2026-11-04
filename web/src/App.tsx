import { useEffect, useMemo, useRef, useState } from 'react';
import type { Run } from '../../shared/types.js';
import { BriefView } from './components/BriefView.js';
import { CommandPalette } from './components/CommandPalette.js';
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
import { Skeleton } from './components/Skeleton.js';
import { TaskActions } from './components/TaskActions.js';
import { TaskComposer } from './components/TaskComposer.js';
import { TaskHeader } from './components/TaskHeader.js';
import { isDesktop } from './desktop.js';
import { inspectorDefaultOpen, useWorkspaceLayout } from './layout.js';
import { useObservability } from './observability.js';
import type { PaletteAction } from './palette.js';
import { diffBadgeLabel, taskCounts, useFleet, useTaskDiff, type StatusFilter } from './store.js';
import { appStrings } from './strings.js';
import { useTheme, type ThemePreference } from './theme.js';

const EMPTY_RUNS: Run[] = [];
type View = 'dashboard' | 'terminal' | 'tasks' | 'compare' | 'usage';
type Tab = 'log' | 'diff' | 'brief';

const themeOptions: Array<{ value: ThemePreference; icon: 'sun' | 'moon' | 'system'; label: string }> = [
  { value: 'light', icon: 'sun', label: 'Giao diện sáng' },
  { value: 'dark', icon: 'moon', label: 'Giao diện tối' },
  { value: 'system', icon: 'system', label: 'Theo hệ thống' },
];

/** The three steps the empty work screen promises, in order. */
const WELCOME_STEPS = ['Chọn repo', 'Viết yêu cầu', 'Duyệt thay đổi'];

/**
 * Topbar chips. Each one is a toggle: pressing the pressed chip again clears the
 * filter, so the sidebar never gets stuck in a narrowed view.
 */
const FILTER_CHIPS: Array<{ id: Exclude<StatusFilter, 'all'>; label: string }> = [
  { id: 'running', label: 'Đang chạy' },
  { id: 'waiting', label: 'Chờ duyệt' },
  { id: 'failed', label: 'Lỗi' },
];

const NAV: Array<{ id: View; label: string; icon: 'dashboard' | 'terminal' | 'tasks' | 'compare' | 'activity' }> = [
  { id: 'dashboard', label: 'Bảng điều khiển', icon: 'dashboard' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'tasks', label: 'Công việc', icon: 'tasks' },
  { id: 'compare', label: 'So sánh agent', icon: 'compare' },
  { id: 'usage', label: appStrings.usageTitle, icon: 'activity' },
];

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'log', label: appStrings.tabs.log },
  { id: 'diff', label: appStrings.tabs.diff },
  { id: 'brief', label: appStrings.tabs.brief },
];

/** Below this width the sidebar is an overlay, so the drawer toggle is shown. */
const DRAWER_MAX_WIDTH = 900;

export function App() {
  const { state, connected, error, tasksLoaded, logState, loadEvents, reload } = useFleet();
  const { theme, setTheme } = useTheme();
  const { layout, updateLayout } = useWorkspaceLayout();
  const [view, setView] = useState<View>('dashboard');
  const cli = useCliWorkspace(() => setView('terminal'));
  const [tab, setTab] = useState<Tab>('log');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [composer, setComposer] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // ≤900px the sidebar is an overlay, so its state is explicit and starts closed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerAllowed, setDrawerAllowed] = useState(() => window.innerWidth <= DRAWER_MAX_WIDTH);
  // Narrow windows open with the inspector closed; a click makes the choice explicit.
  const [inspectorChoice, setInspectorChoice] = useState<boolean | null>(null);
  const [inspectorDefault] = useState(() => inspectorDefaultOpen(window.innerWidth));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const drawerButtonRef = useRef<HTMLButtonElement>(null);
  const { plans, tasks } = state;
  const counts = useMemo(() => taskCounts(tasks), [tasks]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? tasks[0] ?? null;
  const plan = plans.find((entry) => entry.id === selectedTask?.planId) ?? null;
  const runs = selectedTask ? state.runsByTask[selectedTask.id] ?? EMPTY_RUNS : EMPTY_RUNS;
  const latestRun = runs.at(-1) ?? null;
  const selectedRunId = selectedTask && runs.some((run) => run.id === selectedRuns[selectedTask.id]) ? selectedRuns[selectedTask.id]! : latestRun?.id ?? null;
  const events = selectedRunId ? state.eventsByRun[selectedRunId] ?? [] : [];
  const observability = useObservability(view === 'tasks' ? plan?.id : undefined);
  const taskDiff = useTaskDiff(selectedTask?.id ?? null, selectedTask?.status ?? null, tab === 'diff');
  const log = logState(selectedRunId);
  // Without a task there is nothing to inspect, so the panel stays out of the way.
  const inspectorOpen = inspectorChoice ?? inspectorDefault;
  const showInspector = selectedTask !== null && inspectorOpen;
  const drawerShown = drawerAllowed && drawerOpen;

  useEffect(() => { if (selectedRunId) loadEvents(selectedRunId); }, [selectedRunId, loadEvents]);
  useEffect(() => {
    const resize = () => setDrawerAllowed(window.innerWidth <= DRAWER_MAX_WIDTH);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    // Leaving overlay width must not leave an invisible drawer open behind the layout.
    if (!drawerAllowed) setDrawerOpen(false);
  }, [drawerAllowed]);

  const openDrawer = () => { setDrawerOpen(true); window.setTimeout(() => searchRef.current?.focus(), 0); };
  const closeDrawer = () => { setDrawerOpen(false); drawerButtonRef.current?.focus(); };

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target !== null && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPaletteOpen(true); return; }
      if (event.key === 'Escape') {
        // Escape unwinds one layer at a time: palette first, then the drawer.
        if (paletteOpen) { setPaletteOpen(false); return; }
        if (drawerOpen) { setDrawerOpen(false); drawerButtonRef.current?.focus(); }
        return;
      }
      // 1/2/3 pick a task tab, but never while the user is typing in a field.
      if (typing || paletteOpen || composer || view !== 'tasks' || !selectedTask) return;
      const index = ['1', '2', '3'].indexOf(event.key);
      if (index >= 0) { event.preventDefault(); setTab(TABS[index]!.id); }
    };
    document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key);
  }, [drawerOpen, paletteOpen, composer, view, selectedTask]);

  const runPaletteAction = (action: PaletteAction) => {
    if (action.type === 'view') setView(action.view);
    else if (action.type === 'task') { setSelectedTaskId(action.taskId); setView('tasks'); setTab('log'); }
    else if (action.type === 'create') setComposer(true);
    else if (action.type === 'agent') void cli.launch(action.agent);
    else if (action.type === 'theme') setTheme(action.theme);
  };

  const toggleFilter = (id: Exclude<StatusFilter, 'all'>) => setFilter((current) => (current === id ? 'all' : id));

  const viewLabel = view === 'dashboard' ? 'Bảng điều khiển' : view === 'terminal' ? 'Terminal' : view === 'tasks' ? plan?.name ?? appStrings.workspaceFallback : view === 'compare' ? 'So sánh agent' : appStrings.usageTitle;

  return <div className={`app${drawerShown ? ' sidebar-open' : ''}`} style={{ ['--sidebar-user-width' as string]: `${layout.sidebarWidth}px`, ['--inspector-width' as string]: `${layout.inspectorWidth}px` }}>
    <aside id="workspace-sidebar" className="workspace-sidebar" aria-label="Thanh bên">
      <div className="sidebar-brand"><div><strong>Agent Fleet</strong><span>Không gian làm việc AI</span></div><span className="version-tag">{__APP_VERSION__}</span></div>
      <button className="new-task-button" onClick={() => setComposer(true)}><Icon name="plus" size={18} /><span className="nav-label">{appStrings.newTask}</span></button>
      <nav className="workspace-nav" aria-label="Điều hướng chính">
        {NAV.map((item) => <button key={item.id} type="button" aria-label={item.label} title={item.label} aria-current={view === item.id ? 'page' : undefined} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}>
          <Icon name={item.icon} /><span className="nav-label">{item.label}</span>
          {item.id === 'terminal' && <span className="nav-count">{cli.snapshot?.terminalSessions.length ?? 0}</span>}
          {item.id === 'tasks' && <span className="nav-count">{tasks.length}</span>}
        </button>)}
        {counts.waiting > 0 && <span className="nav-waiting" aria-label={`${counts.waiting} công việc chờ duyệt`}><span className="nav-waiting-dot" aria-hidden="true" />{counts.waiting} chờ duyệt</span>}
      </nav>
      <div className="sidebar-divider" /><label className="sidebar-search"><Icon name="search" size={16} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={appStrings.searchPlaceholder} aria-label={appStrings.searchLabel} /><kbd>Ctrl K</kbd></label>
      <div className="sidebar-label">DỰ ÁN<span>{plans.length}</span></div>
      <Sidebar plans={plans} tasks={tasks} filter={filter} query={search} selectedTaskId={selectedTask?.id ?? null} onSelect={(id) => { setSelectedTaskId(id); setView('tasks'); setTab('log'); }} />
      <div className="sidebar-bottom"><span className="local-badge"><span />{appStrings.localWorkspace}</span><div className="theme-switch" role="group" aria-label="Giao diện">{themeOptions.map((option) => <button key={option.value} type="button" className="theme-btn" aria-label={option.label} title={option.label} aria-pressed={theme === option.value} onClick={() => setTheme(option.value)}><Icon name={option.icon} size={16} /></button>)}</div></div>
    </aside>
    {drawerShown && <div className="sidebar-scrim" role="presentation" onClick={closeDrawer} />}
    <ResizeHandle orientation="vertical" label="Điều chỉnh độ rộng thanh bên" value={layout.sidebarWidth} min={190} max={420} onChange={(sidebarWidth) => updateLayout({ sidebarWidth })} />
    <div className="workspace-shell">
      <header className="topbar">
        <button ref={drawerButtonRef} type="button" className="icon-button nav-toggle" aria-label={drawerOpen ? 'Đóng thanh bên' : 'Mở thanh bên'} aria-expanded={drawerShown} aria-controls="workspace-sidebar" onClick={() => (drawerOpen ? closeDrawer() : openDrawer())}><Icon name={drawerOpen ? 'close' : 'panel'} /></button>
        <div className="workspace-breadcrumb"><Icon name={view === 'dashboard' ? 'dashboard' : view === 'terminal' ? 'terminal' : view === 'compare' ? 'compare' : view === 'usage' ? 'activity' : 'folder'} size={17} /><span>{viewLabel}</span>{view === 'tasks' && plan && <span className="breadcrumb-branch">{plan.baseBranch}</span>}</div>
        <div className="status-chips" role="group" aria-label="Trạng thái công việc">
          {FILTER_CHIPS.map((chip) => <button key={chip.id} type="button" className={`status-chip chip-${chip.id}${filter === chip.id ? ' active' : ''}`} aria-pressed={filter === chip.id} onClick={() => toggleFilter(chip.id)}><b>{counts[chip.id]}</b><span>{chip.label}</span></button>)}
        </div>
        <div className={`connection${connected ? ' on' : ''}`} title={connected ? 'Đã kết nối' : 'Mất kết nối'}><span />{connected ? 'Trực tiếp' : 'Đang kết nối lại'}</div>
        <button type="button" className="icon-button palette-button" title="Ô lệnh nhanh (Ctrl K)" aria-label="Mở ô lệnh nhanh" onClick={() => setPaletteOpen(true)}><Icon name="commands" /></button>
        {view === 'tasks' && selectedTask && <button className={`icon-button ${showInspector ? 'selected' : ''}`} title="Thông tin workspace" aria-label="Ẩn hoặc hiện thông tin workspace" aria-expanded={showInspector} onClick={() => setInspectorChoice(!inspectorOpen)}><Icon name="panel" /></button>}
      </header>
      {!connected && <div className="reconnect-banner">Kết nối đang được khôi phục. Dữ liệu sẽ tự đồng bộ khi kết nối trở lại.</div>}
      <div className="body">
        <div className="dashboard-host" hidden={view !== 'dashboard'}><Dashboard plans={plans} tasks={tasks} cli={cli} /></div>
        <div className="terminal-workspace-host" hidden={view !== 'terminal'}><TerminalPage cli={cli} onDashboard={()=>setView('dashboard')}/></div>
        {view === 'compare' ? <main className="main standalone"><ComparePage plans={plans} /></main> : view === 'usage' ? <main className="main standalone"><UsagePage snapshot={observability.snapshot} error={observability.error} plans={plans} tasks={tasks} onSelectTask={(id) => { setSelectedTaskId(id); setView('tasks'); setTab('log'); }} /></main> : view === 'tasks' ? <><main className="main">
          {error && tasksLoaded && <div className="banner banner-error" role="alert">Không tải được dữ liệu: {error}<button type="button" className="banner-retry" onClick={reload}>Thử lại</button></div>}
          {!selectedTask ? (
            !tasksLoaded && error !== null ? <div className="welcome welcome-error"><h1>Chưa tải được danh sách công việc.</h1><p>{error}</p><button className="action-btn action-primary" onClick={reload}><Icon name="refresh" size={17} />Thử lại</button></div>
            : !tasksLoaded ? <div className="welcome welcome-pending"><Skeleton className="welcome-skeleton" label="Đang tải công việc..." lines={5} /></div>
            : <div className="welcome"><FleetMark size={58} /><span className="eyebrow">MỘT KHÔNG GIAN CHO CÁC AGENT</span><h1>Bắt đầu một công việc mới.</h1><p>Giao việc, theo dõi tiến độ và xem thay đổi.<br />Mọi dự án nằm trong cùng một cửa sổ.</p><ol className="welcome-steps" aria-label="Ba bước bắt đầu">{WELCOME_STEPS.map((step, index) => <li key={step}><span className="step-index" aria-hidden="true">{index + 1}</span>{step}</li>)}</ol><button className="action-btn action-primary" onClick={() => setComposer(true)}><Icon name="plus" size={17} />{appStrings.createFirstTask}</button><div className="welcome-agents"><span>Codex</span><span>Qoder</span><span>Antigravity</span><span>OpenCode</span></div></div>
          ) : <>
            <TaskHeader task={selectedTask} run={latestRun} />
            <TaskActions task={selectedTask} run={latestRun} baseBranch={plan?.baseBranch ?? ''} terminalHeight={layout.terminalHeight} onTerminalHeight={(terminalHeight) => updateLayout({ terminalHeight })} />
            <div className="task-tabs" role="tablist" aria-label="Chi tiết công việc">
              {TABS.map((item, index) => <button key={item.id} type="button" role="tab" id={`task-tab-${item.id}`} aria-selected={tab === item.id} aria-controls="task-tab-panel" tabIndex={tab === item.id ? 0 : -1} className={`tab${tab === item.id ? ' active' : ''}`} onClick={() => setTab(item.id)} onKeyDown={(event) => {
                if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); setTab(TABS[(index + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]!.id); }
              }}>{item.id === 'diff' ? diffBadgeLabel(taskDiff.loaded, taskDiff.diff?.files.length ?? 0) : item.label}</button>)}
              <span className="task-tabs-note">{tab === 'log' ? appStrings.tabNotes.log : tab === 'diff' ? appStrings.tabNotes.diff : appStrings.tabNotes.brief}</span>
            </div>
            <div id="task-tab-panel" role="tabpanel" aria-labelledby={`task-tab-${tab}`}>
              {tab === 'log' ? <LogView runs={runs} events={events} runId={selectedRunId} loading={!log.loaded} error={log.error} onRetry={() => { if (selectedRunId) loadEvents(selectedRunId, true); }} onSelectRun={(id) => setSelectedRuns((current) => ({ ...current, [selectedTask.id]: id }))} /> : tab === 'diff' ? <DiffView files={taskDiff.diff?.files ?? []} patch={taskDiff.diff?.patch ?? ''} loading={!taskDiff.loaded} error={taskDiff.error} onRetry={taskDiff.reload} taskId={selectedTask.id} /> : <BriefView runs={runs} />}
            </div>
          </>}
        </main>{showInspector && <><ResizeHandle orientation="vertical" reverse label="Điều chỉnh độ rộng bảng thông tin" value={layout.inspectorWidth} min={260} max={520} onChange={(inspectorWidth) => updateLayout({ inspectorWidth })} /><Inspector snapshot={observability.snapshot} error={observability.error} task={selectedTask} run={latestRun} plan={plan} onClose={() => setInspectorChoice(false)} /></>}</> : null}
      </div>
      <footer className="statusbar"><span><span className={`status-led ${connected ? 'on' : ''}`} />{connected ? 'Đã đồng bộ' : 'Đang chờ kết nối'}</span><span>{isDesktop() ? appStrings.desktopWorkspace : appStrings.webWorkspace}<span className="statusbar-sep">·</span>{appStrings.tasksDone(counts.done)}<span className="statusbar-sep">·</span>Dữ liệu lưu trên máy</span></footer>
    </div>
    {composer && <TaskComposer plans={plans} initialPlanId={plan?.id} onClose={() => setComposer(false)} onCreated={(task) => { setSelectedTaskId(task.id); setView('tasks'); setTab('log'); setComposer(false); }} />}
    <CommandPalette open={paletteOpen} tasks={tasks} onClose={() => setPaletteOpen(false)} onAction={runPaletteAction} />
  </div>;
}
