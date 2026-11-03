import { Activity, ArrowRight, Ban, ChartNoAxesColumnIncreasing, CircleCheck, CircleDashed, CirclePause, CircleX, Clock, Code, Copy, Download, File, Folder, GitCompareArrows, GitMerge, Hand, Info, LayoutDashboard, ListChecks, LoaderCircle, Monitor, Moon, PanelRight, Plus, RefreshCw, Search, SquareTerminal, Sun, Timer, User, X, type LucideIcon } from 'lucide-react';
import type { AgentId } from '../../../shared/types.js';
export type IconName = 'plus' | 'search' | 'tasks' | 'chart' | 'folder' | 'copy' | 'sun' | 'moon' | 'system' | 'terminal' | 'arrow' | 'close' | 'download' | 'panel' | 'file' | 'dashboard' | 'user' | 'info' | 'refresh' | 'commands' | 'compare' | 'activity'
  | 'status-queued' | 'status-running' | 'status-done' | 'status-failed' | 'status-timeout' | 'status-interrupted' | 'status-taken-over' | 'status-merged' | 'status-discarded';
const icons: Record<IconName, LucideIcon> = {
  plus: Plus, search: Search, tasks: ListChecks, chart: ChartNoAxesColumnIncreasing,
  folder: Folder, copy: Copy, sun: Sun, moon: Moon, system: Monitor,
  terminal: SquareTerminal, arrow: ArrowRight, close: X, download: Download,
  panel: PanelRight, file: File, dashboard: LayoutDashboard, user: User, info: Info,
  refresh: RefreshCw, commands: Code, compare: GitCompareArrows, activity: Activity,
  // Task statuses. Each has a distinct silhouette so colour is never the only signal.
  'status-queued': CircleDashed, 'status-running': LoaderCircle, 'status-done': CircleCheck,
  'status-failed': CircleX, 'status-timeout': Timer, 'status-interrupted': CirclePause,
  'status-taken-over': Hand, 'status-merged': GitMerge, 'status-discarded': Ban,
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Glyph = icons[name];
  return <Glyph size={size} strokeWidth={1.75} aria-hidden="true" />;
}
export function FleetMark({ size = 32 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="currentColor" /><path d="M12 28V12h16M12 20h11" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" /><circle cx="28" cy="28" r="3" fill="var(--surface)" /></svg>; }
const names: Record<AgentId, string> = { codex: 'Codex', qodercli: 'Qoder', agy: 'Antigravity', opencode: 'OpenCode', fake: 'Test agent' };
const logos: Partial<Record<AgentId, string>> = { codex: '/agents/codex.png', qodercli: '/agents/qoder.png', agy: '/agents/antigravity.png', opencode: '/agents/opencode.png' };
export function AgentMark({ agent, label = false }: { agent: AgentId; label?: boolean }) { return <span className={`agent-identity agent-${agent}`}><span className={`agent-mark${logos[agent] ? ' agent-chip' : ''} vendor-${agent}`} title={names[agent]} aria-hidden="true">{logos[agent] ? <img src={logos[agent]} alt="" draggable={false} /> : 'F'}</span>{label && <span>{names[agent]}</span>}</span>; }
