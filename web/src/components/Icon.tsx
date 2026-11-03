import type { AgentId } from '../../../shared/types.js';
export type IconName = 'plus' | 'search' | 'tasks' | 'chart' | 'folder' | 'copy' | 'sun' | 'moon' | 'system' | 'terminal' | 'arrow' | 'close' | 'download' | 'panel' | 'file' | 'dashboard' | 'user' | 'info' | 'refresh' | 'commands' | 'compare' | 'activity';
const paths: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14', search: 'm21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  tasks: 'M9 5h11M9 12h11M9 19h11M3 5l1 1 2-2M3 12l1 1 2-2M3 19l1 1 2-2', chart: 'M4 19h16M7 15V9M12 15V4M17 15v-5',
  folder: 'M3 7V5h6l2 2h10v12H3V7Z', copy: 'M9 9h11v11H9zM15 5V3H3v12h2', sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M19 5l-1 1M6 18l-1 1M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  moon: 'M20.5 13a8.5 8.5 0 1 1-9.5-9.5 7 7 0 0 0 9.5 9.5', system: 'M3 4h18v13H3zM8 21h8M12 17v4',
  terminal: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 4 4 4-4 4m7 0h3', arrow: 'M5 12h14m-5-5 5 5-5 5', close: 'm6 6 12 12M18 6 6 18',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4', panel: 'M3 4h18v16H3zM15 4v16', file: 'M6 3h8l4 4v14H6zM14 3v5h4',
  dashboard: 'M4 4h7v6H4zM13 4h7v10h-7zM4 12h7v8H4zM13 16h7v4h-7z',
  user: 'M20 21v-2a7 7 0 0 0-14 0v2M13 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
  info: 'M12 8h.01M12 11v6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18A8 8 0 0 1 5 15',
  commands: 'm8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16',
  compare: 'M7 3v18M17 3v18M3 7l4-4 4 4m2 10 4 4 4-4M7 12h10',
  activity: 'M3 12h4l3-8 4 16 3-8h4',
};
export function Icon({ name, size = 18 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
export function FleetMark({ size = 32 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true"><rect width="40" height="40" rx="12" fill="currentColor" /><path d="M12 28V12h16M12 20h11" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" /><circle cx="28" cy="28" r="3" fill="var(--surface)" /></svg>; }
const names: Record<AgentId, string> = { codex: 'Codex', qodercli: 'Qoder', agy: 'Antigravity', opencode: 'OpenCode', fake: 'Test agent' };
const logos: Partial<Record<AgentId, string>> = { codex: '/agents/codex.png', qodercli: '/agents/qoder.png', agy: '/agents/antigravity.png', opencode: '/agents/opencode.png' };
export function AgentMark({ agent, label = false }: { agent: AgentId; label?: boolean }) { return <span className={`agent-identity agent-${agent}`}><span className={`agent-mark vendor-${agent}`} title={names[agent]} aria-hidden="true">{logos[agent] ? <img src={logos[agent]} alt="" draggable={false} /> : 'F'}</span>{label && <span>{names[agent]}</span>}</span>; }
