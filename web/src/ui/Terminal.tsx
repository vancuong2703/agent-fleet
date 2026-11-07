import { lazy, Suspense, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Plan } from '../../../shared/types.js';
import type { CliWorkspace } from '../cli-workspace.js';
import type { TerminalSessionInfo } from '../../../shared/dashboard.js';
import type { TerminalConnectionStatus } from '../components/TerminalPanel.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { Icon } from '../components/Icon.js';
import { ResizeHandle } from '../components/ResizeHandle.js';
import { usePaneSize } from '../components/usePaneSize.js';
import { copyText } from '../desktop.js';
import { Logo, Notice } from './Common.js';
import { useLanguage } from './language.js';
import { agentNames, clock, tabIndexForKey } from './model.js';
const TerminalPanel = lazy(() => import('../components/TerminalPanel.js').then(module => ({ default: module.TerminalPanel })));

export const TERMINAL_SIDE_KEY = 'fleet.terminal.sideWidth';
export const TERMINAL_SIDE_COLLAPSED_KEY = 'fleet.terminal.sideCollapsed';
const SIDE_DEFAULT = 280;

function readCollapsed(): boolean {
  try { return window.localStorage.getItem(TERMINAL_SIDE_COLLAPSED_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(value: boolean): void {
  try { if (value) window.localStorage.setItem(TERMINAL_SIDE_COLLAPSED_KEY, '1'); else window.localStorage.removeItem(TERMINAL_SIDE_COLLAPSED_KEY); } catch { /* Blocked storage: ignore. */ }
}

export function Terminal({ cli, plans }: { cli: CliWorkspace; plans: Plan[] }) {
  const { t } = useLanguage(); const [closing, setClosing] = useState<TerminalSessionInfo | null>(null); const [picker, setPicker] = useState(false);
  const [live, setLive] = useState<Record<string, TerminalConnectionStatus>>({});
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const setCollapsed = (value: boolean) => { setCollapsedState(value); writeCollapsed(value); };
  const side = usePaneSize({ storageKey: TERMINAL_SIDE_KEY, min: 220, max: total => Math.min(520, Math.floor(total * 0.45)), fallback: () => SIDE_DEFAULT });
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const sessions = cli.snapshot?.terminalSessions ?? []; const active = sessions.find(session => session.id === cli.activeId) ?? sessions[0];
  const tool = cli.snapshot?.tools.find(tool => tool.agent === active?.agent);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => { const next = tabIndexForKey(event.key, index, sessions.length); if (next !== null) { event.preventDefault(); cli.select(sessions[next].id); refs.current[sessions[next].id]?.focus(); } };
  // The socket the panel owns is the truth; the snapshot only covers sessions whose panel has not reported yet.
  const status = (session: TerminalSessionInfo): TerminalConnectionStatus => live[session.id] ?? (session.connected ? 'connected' : 'connecting');
  const statusLabel = (value: TerminalConnectionStatus) => value === 'connected' ? t('Connected', 'Đã kết nối') : value === 'connecting' ? t('Connecting', 'Đang kết nối') : value === 'ended' ? t('Ended', 'Đã kết thúc') : t('Disconnected', 'Đã ngắt kết nối');
  const headline = !active ? '—' : status(active) === 'ended' ? t('Ended', 'Đã kết thúc') : status(active) === 'disconnected' ? t('Disconnected', 'Đã ngắt kết nối') : t('Running', 'Đang chạy');
  const count = sessions.length === 1 ? t('1 session', '1 phiên') : t(`${sessions.length} sessions`, `${sessions.length} phiên`);
  const copyCommand = (text: string, label: string) => void copyText(text).then(() => cli.setMessage(label, 'success')).catch(cause => cli.setMessage(String(cause)));
  const sideLabel = collapsed ? t('Show info column', 'Hiện cột thông tin') : t('Hide info column', 'Ẩn cột thông tin');
  return <div className="wrap terminal-page" data-page="terminal">
    <header className="head terminal-top">
      <div className="head-title-block">
        <div className="eyebrow">{t('Interactive shell', 'Phiên dòng lệnh')}</div>
        <h1 className="title sm">{t('CLI Terminal', 'Terminal CLI')}</h1>
      </div>
      <div className="sessions">{!sessions.length && <span className="head-empty-hint">{t('Ready · Pick an agent below to launch', 'Sẵn sàng · Chọn công cụ bên dưới để mở')}</span>}<div className="stablist terminal-tablist" role="tablist" aria-label={t('CLI sessions', 'Phiên CLI')}>{sessions.map((session, index) => <button className="stab" id={`tab-${session.id}`} key={session.id} role="tab" ref={element => { refs.current[session.id] = element; }} tabIndex={active?.id === session.id ? 0 : -1} aria-selected={active?.id === session.id} aria-controls={`cli-${session.id}`} onClick={() => cli.select(session.id)} onKeyDown={event => move(event, index)}><i className={`dot${status(session) === 'connected' ? '' : ' warn'}`} />{session.title}</button>)}</div></div>
      <button className="btn ghost newbtn" onClick={() => setPicker(value => !value)}><Icon name="plus" size={14} />{t('New session', 'Phiên mới')}</button>
      <span className="stamp">{count}</span>
      <button className="btn ghost side-toggle" aria-label={sideLabel} title={sideLabel} aria-pressed={collapsed} onClick={() => setCollapsed(!collapsed)}><Icon name="panel" size={14} /></button>
    </header>
    {cli.message && <Notice message={cli.message} error={cli.messageKind === 'error'} />}
    <div className={`terminal-grid${collapsed ? ' is-side-collapsed' : ''}`} ref={side.containerRef} style={{ '--terminal-side-width': `${side.size}px` } as CSSProperties}>
      <div className="terminal-main">
        {(picker || !sessions.length) && <section className="panel session-picker"><h4>{t('Start a CLI session', 'Mở phiên CLI')}</h4><label className="launch-location">{t('Working directory', 'Vị trí mở CLI')}<select aria-label={t('CLI location', 'Vị trí mở CLI')} value={cli.selection} onChange={event => cli.setSelection(event.target.value)}><option value="workspace">{t('Tool workspace', 'Không gian riêng của công cụ')}</option>{plans.map(plan => <option key={plan.id} value={`plan:${plan.id}`}>{plan.name}</option>)}</select></label><div className="session-shortcuts">{cli.snapshot?.tools.map(tool => <button className="btn" key={tool.agent} disabled={Boolean(cli.launching)} onClick={() => { void cli.launch(tool.agent); setPicker(false); }} aria-label={`${t('Open', 'Mở')} ${tool.title}`}><Logo agent={tool.agent} small />{agentNames[tool.agent]}<Icon name="plus" size={13} /></button>)}</div></section>}
        <div className="terminal-session-stack">{sessions.map(session => <section key={session.id} role="tabpanel" id={`cli-${session.id}`} aria-labelledby={`tab-${session.id}`} hidden={active?.id !== session.id} className="terminal-session"><Suspense fallback={<p role="status">{t('Connecting…', 'Đang kết nối…')}</p>}><TerminalPanel fill hideable socketPath={`/ws/terminal?sessionId=${encodeURIComponent(session.id)}`} title={cli.snapshot?.tools.find(tool => tool.agent === session.agent)?.title ?? agentNames[session.agent]} subtitle={session.cwd} closeLabel={t('End process', 'Kết thúc tiến trình')} closeTitle={t('End process stops the CLI session.', 'Kết thúc tiến trình sẽ dừng phiên CLI.')} onClose={() => setClosing(session)} onConnectionChange={next => setLive(current => current[session.id] === next ? current : { ...current, [session.id]: next })} /></Suspense></section>)}</div>
      </div>
      {!collapsed && <ResizeHandle className="terminal-divider" orientation="vertical" reverse label={t('Resize the info column', 'Điều chỉnh độ rộng cột thông tin')} value={side.size} min={side.min} max={side.max} onChange={side.setSize} onReset={side.reset} />}
      <aside className="terminal-side" aria-label={t('Session info', 'Thông tin phiên')}>
        <section className="panel"><h4>{t('Session', 'Phiên làm việc')}<span className="spacer">{headline}</span></h4><div className="kv">
          <div className="k"><span className="kl">Agent</span><span className="v">{active ? agentNames[active.agent] : '—'}</span></div>
          <div className="k"><span className="kl">{t('Working dir', 'Thư mục làm việc')}</span><span className="v cwd"><span className="cwd-value" title={active?.cwd}>{active?.cwd ?? '—'}</span>{active && <button className="btn ghost cwd-copy" aria-label={t('Copy working directory', 'Sao chép thư mục làm việc')} title={t('Copy working directory', 'Sao chép thư mục làm việc')} onClick={() => copyCommand(active.cwd, t('Directory copied.', 'Đã sao chép thư mục.'))}><Icon name="copy" size={13} /></button>}</span></div>
          <div className="k"><span className="kl">Model</span><span className="v">{tool?.lastCheck?.currentModel?.label ?? '—'}</span></div>
          <div className="k"><span className="kl">{t('Started', 'Bắt đầu')}</span><span className="v">{clock(active?.createdAt)}</span></div>
          <div className="k"><span className="kl">{t('Status', 'Trạng thái')}</span><span className="v">{active ? statusLabel(status(active)) : '—'}</span></div>
        </div></section>
        <section className="panel"><h4>{t('Commands', 'Lệnh thường dùng')}</h4>{tool?.suggestions.map(hint => <div className="session-command" key={hint.id}><code>{hint.command === '\u0003' ? 'Ctrl+C' : hint.command}</code><button className="btn ghost" aria-label={`${t('Copy', 'Sao chép')} ${hint.label}`} onClick={() => copyCommand(hint.command === '\u0003' ? 'Ctrl+C' : hint.command, t('Command copied.', 'Đã sao chép lệnh.'))}><Icon name="copy" size={14} /></button></div>)}{!tool && <p className="small muted">{t('Open a session to see CLI commands.', 'Mở phiên để xem các lệnh CLI.')}</p>}</section>
      </aside>
    </div>
    {closing && <ConfirmDialog title={t('End this CLI process?', 'Kết thúc tiến trình CLI?')} message={t(`Stop ${closing.title} and close this process?`, `Dừng ${closing.title} và đóng tiến trình của phiên này?`)} confirmLabel={t('End process', 'Kết thúc tiến trình')} cancelLabel={t('Cancel', 'Huỷ bỏ')} danger onConfirm={() => { void cli.close(closing.id); setClosing(null); }} onCancel={() => setClosing(null)} />}
  </div>;
}
