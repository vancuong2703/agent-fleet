import { Cpu, Contrast, Menu } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DashboardAgent } from '../../../shared/dashboard.js';
import { useCliWorkspace } from '../cli-workspace.js';
import { CommandPalette } from '../components/CommandPalette.js';
import { Icon, type IconName } from '../components/Icon.js';
import { TaskComposer } from '../components/TaskComposer.js';
import { useFleet } from '../store.js';
import { useObservability, formatBytes } from '../observability.js';
import { useTheme } from '../theme.js';
import { AppearanceMenu } from './AppearanceMenu.js';
import { type PaletteAction } from '../palette.js';
import { Compare } from './Compare.js';
import { Dashboard } from './Dashboard.js';
import { Guide } from './Guide.js';
import { Jobs } from './Jobs.js';
import { Resources } from './Resources.js';
import { Terminal } from './Terminal.js';
import { ToolDetail } from './ToolDetail.js';
import { Meter, Notice } from './Common.js';
import { LanguageProvider, useLanguage } from './language.js';
import { known } from './model.js';

type View = 'dashboard' | 'terminal' | 'tasks' | 'compare' | 'usage' | 'guide' | 'tool';
const NAV: Array<{ id: Exclude<View, 'tool'>; en: string; vi: string; icon: IconName }> = [
  { id: 'dashboard', en: 'Dashboard', vi: 'Bảng điều khiển', icon: 'dashboard' },
  { id: 'terminal', en: 'Terminal', vi: 'Terminal', icon: 'terminal' },
  { id: 'tasks', en: 'Jobs', vi: 'Công việc', icon: 'tasks' },
  { id: 'compare', en: 'Compare', vi: 'So sánh agent', icon: 'compare' },
  { id: 'usage', en: 'Resources & usage', vi: 'Tài nguyên', icon: 'activity' },
];
export function Workspace() { return <LanguageProvider><WorkspaceBody /></LanguageProvider>; }
function WorkspaceBody() {
  const fleet = useFleet(); const { state, connected } = fleet;
  const { language, setLanguage, t } = useLanguage(); const { theme, setTheme } = useTheme();
  const [view, setView] = useState<View>('dashboard'); const [detailAgent, setDetailAgent] = useState<DashboardAgent>('codex'); const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState(false); const [palette, setPalette] = useState(false); const [drawer, setDrawer] = useState(false); const [hardware, setHardware] = useState(true);
  const navToggle = useRef<HTMLButtonElement>(null);
  const cli = useCliWorkspace(() => setView('terminal')); const observations = useObservability();
  const go = (next: View) => { setView(next); setDrawer(false); };
  const selectTask = (id: string) => { setSelectedId(id); go('tasks'); };
  const details = (agent: DashboardAgent) => { setDetailAgent(agent); go('tool'); };
  useEffect(() => {
    // Capture phase on purpose: xterm listens for keydown on its hidden
    // textarea, so a bubbling document handler loses the race and the CLI
    // receives the ^K byte. Capturing here and stopping propagation keeps
    // Ctrl+K a palette shortcut everywhere, including inside a focused
    // terminal, and leaves Escape to close the drawer.
    const key = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') { event.preventDefault(); event.stopPropagation(); setPalette(true); return; }
      if (event.key === 'Escape') { if (drawer) { setDrawer(false); navToggle.current?.focus(); } }
    };
    document.addEventListener('keydown', key, true); return () => document.removeEventListener('keydown', key, true);
  }, [drawer]);
  const paletteAction = (action: PaletteAction) => { if (action.type === 'view') go(action.view); else if (action.type === 'task') selectTask(action.taskId); else if (action.type === 'create') setComposer(true); else if (action.type === 'theme') setTheme(action.theme); else if (action.type === 'agent') void cli.launch(action.agent); };
  const resource = observations.snapshot?.resource; const totalMemory = observations.snapshot?.system.totalMemoryBytes;
  const current = NAV.find(item => item.id === view); const crumb = view === 'guide' ? t('Leader guide', 'Hướng dẫn leader') : view === 'tool' ? t('Tool details', 'Chi tiết công cụ') : current ? t(current.en, current.vi) : '';
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';
  return <div className={`app${drawer ? ' drawer-open' : ''}`}>
    <aside id="workspace-sidebar" className="side workspace-sidebar" aria-label={t('Navigation', 'Điều hướng')}>
      <div className="brand"><span className="mk">AF</span><span><b>Agent Fleet</b><small>AI WORKSPACE</small></span></div>
      <nav className="nav" aria-label={t('Main navigation', 'Điều hướng chính')}>{NAV.map(item => <button type="button" key={item.id} aria-label={t(item.en, item.vi)} aria-current={view === item.id || view === 'tool' && item.id === 'dashboard' ? 'page' : undefined} onClick={() => go(item.id)}><Icon name={item.icon} size={15} /><span>{t(item.en, item.vi)}</span></button>)}</nav>
      <div className="sidebar-extras"><button type="button" className={`sidebar-guide${view === 'guide' ? ' active' : ''}`} aria-current={view === 'guide' ? 'page' : undefined} onClick={() => go('guide')}><Icon name="file" size={15} />{t('Leader guide', 'Hướng dẫn leader')}</button></div>
      <section className="side-res" id="resStrip" hidden={!hardware} aria-label={t('Hardware measurements', 'Số đo phần cứng')}><span className="rlabel">{t('Hardware', 'Phần cứng')}</span><div className="r"><div className="r-top"><span className="rname">CPU</span><b>{known(resource?.cpuPercent) ? resource.cpuPercent.toFixed(1) : '—'}</b><span className="unit">%</span></div><Meter pct={resource?.cpuPercent} /></div><div className="r"><div className="r-top"><span className="rname">RAM</span><b>{resource ? formatBytes(resource.memoryBytes) : '—'}</b><span className="unit">{known(totalMemory) ? `/ ${formatBytes(totalMemory)}` : ''}</span></div><Meter pct={resource && totalMemory ? resource.memoryBytes / totalMemory * 100 : null} /></div><div className="r"><div className="r-top"><span className="rname">GPU</span><b>{known(resource?.gpu?.utilizationPercent) ? resource.gpu.utilizationPercent.toFixed(1) : '—'}</b><span className="unit">%{resource?.gpu?.scope === 'system' ? t(' system', ' hệ thống') : ''}</span></div><Meter pct={resource?.gpu?.utilizationPercent} /></div></section>
      <div className="foot side-foot"><span>DESKTOP · v{__APP_VERSION__}</span><span className={`connection${connected ? ' on' : ''}`} title={connected ? 'Đã kết nối' : 'Mất kết nối'}><i className={`dot${connected ? '' : ' warn'}`} aria-label={connected ? t('Connected', 'Đã kết nối') : t('Reconnecting', 'Đang kết nối lại')} /></span></div>
    </aside>
    {drawer && <button className="drawer-scrim" aria-label={t('Close navigation', 'Đóng điều hướng')} onClick={() => { setDrawer(false); navToggle.current?.focus(); }} />}
    <main className="main workspace-shell"><header className="topbar"><button ref={navToggle} className="tbtn nav-toggle" aria-label={t('Open navigation', 'Mở điều hướng')} aria-expanded={drawer} aria-controls="workspace-sidebar" onClick={() => setDrawer(value => !value)}><Menu size={16} /></button><span className="crumb">{crumb}</span><span className="spacer" /><div className="toggle" role="group" aria-label={t('Language', 'Ngôn ngữ')}><button aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button><button aria-pressed={language === 'vi'} onClick={() => setLanguage('vi')}>VI</button></div><button className="tbtn" id="resToggle" aria-pressed={hardware} aria-label={t('Hardware', 'Phần cứng')} onClick={() => setHardware(value => !value)}><Cpu size={15} /><span>{t('Hardware', 'Phần cứng')}</span></button><button className="tbtn" onClick={() => setTheme(nextTheme)} aria-label={t('Theme', 'Giao diện')} title={t('Switch light / dark / system', 'Đổi sáng / tối / hệ thống')}><Contrast size={15} /><span>{theme === 'light' ? t('Light', 'Sáng') : theme === 'dark' ? t('Dark', 'Tối') : t('System', 'Hệ thống')}</span></button><AppearanceMenu isDark={theme === 'dark' || (theme === 'system' && typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark')} /></header>
      {!connected && <Notice message={t('Reconnecting to the local server. Your workspace will resync automatically.', 'Đang kết nối lại server cục bộ. Không gian làm việc sẽ tự đồng bộ.')} />}
      <div className="view-stack"><section className="view-panel dashboard-host" hidden={view !== 'dashboard'}><Dashboard visible={view === 'dashboard'} cli={cli} plans={state.plans} tasks={state.tasks} runsByTask={state.runsByTask} runsLoadState={state.runsLoadState} onRetryRuns={() => void fleet.retryRuns()} onDetails={details} onTask={selectTask} /></section><section className="view-panel terminal-workspace-host" hidden={view !== 'terminal'}><Terminal cli={cli} plans={state.plans} /></section>
        {view === 'compare' && <Compare cli={cli} plans={state.plans} onDetails={details} />}
        {view === 'tasks' && <Jobs state={state} selectedId={selectedId} onSelect={setSelectedId} onCreate={() => setComposer(true)} loaded={fleet.tasksLoaded} error={fleet.error} errorCode={fleet.errorCode} runErrors={fleet.runErrors} retryRuns={fleet.retryRuns} reload={fleet.reload} loadEvents={fleet.loadEvents} logState={fleet.logState} snapshot={observations.snapshot} />}
        {view === 'usage' && <Resources cli={cli} state={state} snapshot={observations.snapshot} error={observations.error} onRefresh={observations.reload} />}
        {view === 'guide' && <Guide />}{view === 'tool' && <ToolDetail agent={detailAgent} cli={cli} onBack={() => go('dashboard')} />}
      </div>
    </main>
    {composer && <TaskComposer plans={state.plans} initialPlanId={state.tasks.find(task => task.id === selectedId)?.planId} onClose={() => setComposer(false)} onCreated={task => { setComposer(false); selectTask(task.id); }} />}
    <CommandPalette open={palette} tasks={state.tasks} onClose={() => setPalette(false)} onAction={paletteAction} />
  </div>;
}
