import { useEffect, useRef, useState } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { Icon } from './Icon.js';
import { ResizeHandle } from './ResizeHandle.js';
import { useLanguage } from '../ui/language.js';

export const TERMINAL_FONT_KEY = 'fleet.terminal.fontSize';
export const TERMINAL_FONT_DEFAULT = 15;
const TERMINAL_FONT_MIN = 10;
const TERMINAL_FONT_MAX = 22;

export function clampTerminalFontSize(value: number): number {
  if (!Number.isFinite(value)) return TERMINAL_FONT_DEFAULT;
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(value)));
}

/** localStorage throws in private mode and locked-down webviews; the size is a convenience only. */
function terminalStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readTerminalFontSize(storage: Storage | null = terminalStorage()): number {
  if (!storage) return TERMINAL_FONT_DEFAULT;
  try {
    const raw = storage.getItem(TERMINAL_FONT_KEY);
    if (raw === null) return TERMINAL_FONT_DEFAULT;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampTerminalFontSize(parsed) : TERMINAL_FONT_DEFAULT;
  } catch { return TERMINAL_FONT_DEFAULT; }
}

function saveTerminalFontSize(value: number, storage: Storage | null = terminalStorage()): void {
  if (!storage) return;
  try { storage.setItem(TERMINAL_FONT_KEY, String(value)); } catch { /* Blocked storage: ignore. */ }
}

export interface TerminalPanelProps {
  taskId?: string;
  /** WebSocket path override for dashboard sessions; defaults to the task PTY socket. */
  socketPath?: string;
  title?: string;
  subtitle?: string;
  fill?: boolean;
  closeLabel?: string;
  height?: number;
  onHeightChange?: (height: number) => void;
  onInputReady?: (write: ((text: string) => void) | null) => void;
  onClose: () => void;
  /** Tooltip for the close button; Terminal explains that it ends the process, Jobs that it only hides. */
  closeTitle?: string;
  hideable?: boolean;
  /** Live socket state, so the page can show the same status as the toolbar. */
  onConnectionChange?: (status: TerminalConnectionStatus) => void;
}

export type TerminalConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'ended';

/** The toolbar keeps its state as display text; map it back to a stable status. */
export function connectionStatus(connection: string): TerminalConnectionStatus {
  if (connection === 'Đã kết nối') return 'connected';
  if (connection.startsWith('Đã kết thúc')) return 'ended';
  if (connection === 'Đang kết nối' || connection === 'Connecting') return 'connecting';
  return 'disconnected';
}

/** ConPTY redraws the whole TUI per resize, so the socket only hears about the settled size. */
export const TERMINAL_RESIZE_DEBOUNCE_MS = 120;

type ServerMessage = { t: 'out'; d: string } | { t: 'exit'; code: number };

/** Windows CMD (Campbell) ANSI16 — fixed regardless of the app theme so agent output stays readable. */
const cmdTheme: ITheme = {
  background: '#0c0c0c', foreground: '#cccccc', cursor: '#ffffff', selectionBackground: '#2f5fbe',
  black: '#0c0c0c', red: '#c50f1f', green: '#13a10e', yellow: '#c19c00', blue: '#0037da', magenta: '#881798', cyan: '#3a96dd', white: '#cccccc',
  brightBlack: '#767676', brightRed: '#e74856', brightGreen: '#16c60c', brightYellow: '#f9f1a5', brightBlue: '#3b78ff', brightMagenta: '#b4009e', brightCyan: '#61d6d6', brightWhite: '#f2f2f2',
};

export function TerminalPanel({ taskId, socketPath, title, subtitle, fill = false, closeLabel = 'Ẩn', height, onHeightChange, onInputReady, onClose, closeTitle, hideable = false, onConnectionChange }: TerminalPanelProps) {
  const { t } = useLanguage();
  const [bodyHidden, setBodyHidden] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const resizeRef = useRef<(() => void) | null>(null);
  const inputReadyRef = useRef(onInputReady);
  inputReadyRef.current = onInputReady;
  const connectionChangeRef = useRef(onConnectionChange);
  connectionChangeRef.current = onConnectionChange;
  const [connection, setConnection] = useState(t("Connecting", "Đang kết nối"));
  const [fontSize, setFontSize] = useState(readTerminalFontSize);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);
  const [maximized, setMaximized] = useState(false);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const searchFrom = useRef(0);
  const heightBeforeMax = useRef<number | null>(null);
  const applyFontSize = (next: number) => { const size = clampTerminalFontSize(next); setFontSize(size); saveTerminalFontSize(size); };
  const copy = async () => { const text = terminalRef.current?.getSelection(); if (!text) { setNotice(t("Select terminal text before copying.", "Chọn nội dung terminal trước khi sao chép.")); return; } try { await navigator.clipboard.writeText(text); setNotice(t("Copied.", "Đã sao chép.")); } catch { setNotice(t("Clipboard is unavailable.", "Không truy cập được clipboard.")); } };
  const paste = async () => { try { const text = await navigator.clipboard.readText(); terminalRef.current?.paste(text); terminalRef.current?.focus(); } catch { setNotice(t("Cannot read clipboard. Use Ctrl+Shift+V in the terminal.", "Không đọc được clipboard. Dùng Ctrl+Shift+V trong terminal.")); } };
  const find = () => { const term = terminalRef.current; if (!term || !query) return; const buffer = term.buffer.active; for (let offset = 0; offset < buffer.length; offset++) { const row = (searchFrom.current + offset) % buffer.length; const text = buffer.getLine(row)?.translateToString(true) ?? ''; const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()); if (index >= 0) { term.select(index, row, query.length); term.scrollToLine(Math.max(0, row - 3)); searchFrom.current = row + 1; setNotice(null); return; } } setNotice(t("No matches found.", "Không tìm thấy nội dung.")); };
  useEffect(() => {
    const container = containerRef.current; if (!container) return;
    const path = socketPath ?? (taskId ? `/ws/pty?taskId=${encodeURIComponent(taskId)}` : null);
    if (!path) { setConnection('Thiếu phiên terminal'); return; }
    setSocketError(null);
    let finished = false;
    // A socket can still dispatch a queued event after unmount or reconnect.
    let disposed = false;
    const term = new Terminal({ convertEol: true, cursorBlink: true, fontSize: readTerminalFontSize(), fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace', lineHeight: 1.25, scrollback: 10_000, theme: cmdTheme, drawBoldTextInBrightColors: true, allowProposedApi: false });
    const fit = new FitAddon(); term.loadAddon(fit); term.open(container); fit.fit(); terminalRef.current = term; fitRef.current = fit;
    const socket = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}${path}${path.includes('?') ? '&' : '?'}cols=${term.cols}&rows=${term.rows}`);
    let resizeFrame = 0;
    let sendTimer = 0;
    let lastSize = '';
    // Fit follows every frame of a drag; only the settled size reaches the PTY.
    const sendSize = () => {
      sendTimer = 0;
      if (disposed || !container.isConnected || container.clientWidth < 40 || container.clientHeight < 40) return;
      const size = `${term.cols}:${term.rows}`;
      // ConPTY redraws the entire TUI on resize, even for identical dimensions.
      // A ResizeObserver/fit feedback loop must not continuously resize it.
      if (socket.readyState === WebSocket.OPEN && size !== lastSize) {
        lastSize = size;
        socket.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
      }
    };
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (!container.isConnected || container.clientWidth < 40 || container.clientHeight < 40) return;
        fit.fit();
        window.clearTimeout(sendTimer);
        sendTimer = window.setTimeout(sendSize, TERMINAL_RESIZE_DEBOUNCE_MS);
      });
    };
    resizeRef.current = resize;
    const write = (text: string) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'in', d: text })); };
    let wheelRemainder = 0;
    term.attachCustomWheelEventHandler((event) => {
      event.stopPropagation();
      event.preventDefault();
      const buffer = term.buffer.active;
      const viewport = Array.from({length:term.rows},(_,row)=>buffer.getLine(buffer.viewportY+row)?.translateToString(true)??'').join('\n');
      const pager = buffer.viewportY === buffer.baseY && /pgup\/pgdown\s+Page|↑\/↓\s+Scroll/i.test(viewport);
      if (!pager && term.modes.mouseTrackingMode !== 'none') return true; // native TUI mouse protocol
      wheelRemainder += event.deltaMode === 1 ? event.deltaY : event.deltaMode === 2 ? event.deltaY * term.rows : event.deltaY / 40;
      const lines = Math.trunc(wheelRemainder);
      if (!lines) return false;
      wheelRemainder -= lines;
      if (pager || buffer.type === 'alternate') {
        // Pagers such as AGY /usage keep their own scroll position in the
        // alternate screen. Translate the wheel into real PTY arrow input.
        write((lines > 0 ? '\x1b[B' : '\x1b[A').repeat(Math.min(12, Math.abs(lines))));
      } else term.scrollLines(lines);
      return false;
    });
    socket.onopen = () => { if (disposed) return; setSocketError(null); setConnection('Đã kết nối'); resize(); term.focus(); inputReadyRef.current?.(write); };
    socket.onmessage = (event) => { if (disposed) return; try { const message = JSON.parse(String(event.data)) as ServerMessage; if (message.t === 'out') term.write(message.d); else if (message.t === 'exit') { finished = true; setConnection(`Đã kết thúc · ${message.code}`); term.write(`\r\n\x1b[90m[phiên đã kết thúc, mã ${message.code}]\x1b[0m\r\n`); } } catch { /* Invalid frames never tear down a working PTY. */ } };
    socket.onerror = () => { if (disposed) return; setConnection(t("Connection error", "Lỗi kết nối")); setSocketError(t("Lost connection to the terminal process.", "Mất kết nối tới tiến trình terminal.")); };
    socket.onclose = () => { if (disposed) return; inputReadyRef.current?.(null); setConnection((current) => current.startsWith('Đã kết thúc') ? current : t("Disconnected", "Đã ngắt kết nối")); if (!finished) setSocketError(t("Lost connection to the terminal process.", "Mất kết nối tới tiến trình terminal.")); };
    const input = term.onData(write);
    term.attachCustomKeyEventHandler((event) => { if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.code === 'KeyC') { const text = term.getSelection(); if (text) void navigator.clipboard.writeText(text).catch(() => {}); return false; } if (event.type === 'keydown' && event.ctrlKey && event.shiftKey && event.code === 'KeyV') { void navigator.clipboard.readText().then((text) => term.paste(text)).catch(() => setNotice(t("Clipboard is unavailable.", "Clipboard không khả dụng."))); return false; } return true; });
    const observer = new ResizeObserver(resize); observer.observe(container);
    return () => { disposed = true; cancelAnimationFrame(resizeFrame); window.clearTimeout(sendTimer); observer.disconnect(); input.dispose(); inputReadyRef.current?.(null); socket.onclose = null; socket.close(); term.dispose(); terminalRef.current = null; fitRef.current = null; resizeRef.current = null; };
  }, [taskId, socketPath, reconnectKey]);
  useEffect(() => { connectionChangeRef.current?.(connectionStatus(connection)); }, [connection]);
  useEffect(() => { if (terminalRef.current) { terminalRef.current.options.fontSize = fontSize; resizeRef.current?.(); } }, [fontSize]);
  useEffect(() => { resizeRef.current?.(); }, [height]);
  const maxHeight = Math.max(350, window.innerHeight - 250);
  const currentHeight = height ?? 380;
  const toggleMaximize = () => setMaximized((current) => {
    if (current) { if (heightBeforeMax.current != null) onHeightChange?.(heightBeforeMax.current); heightBeforeMax.current = null; return false; }
    heightBeforeMax.current = currentHeight; onHeightChange?.(maxHeight); return true;
  });
  return <div className={`terminal-panel${fill?' terminal-fill':''}${bodyHidden ? ' is-hidden' : ''}`} style={fill ? undefined : height != null ? { height } : undefined}>
    {onHeightChange && <ResizeHandle orientation="horizontal" reverse label="Điều chỉnh chiều cao terminal" value={currentHeight} min={240} max={maxHeight} onChange={onHeightChange} />}
    <div className="terminal-head">
      <span className="terminal-title"><Icon name="terminal" size={14} /><span className="terminal-caption" title={subtitle}>{title ?? 'Terminal'}{subtitle && <small>{subtitle}</small>}</span><span className={`terminal-connection ${connection === 'Đã kết nối' ? 'on' : ''}`}>{connection === 'Đã kết nối' ? t("Connected", "Đã kết nối") : connection.startsWith('Đã kết thúc') ? t(connection.replace('Đã kết thúc', 'Exited'), connection) : connection === 'Thiếu phiên terminal' ? t("No terminal session", "Thiếu phiên terminal") : connection}</span></span>
      <div className="terminal-tools"><button className="icon-button" title={t("Smaller font", "Giảm cỡ chữ")} aria-label={t("Decrease terminal font size", "Giảm cỡ chữ terminal")} onClick={() => applyFontSize(fontSize - 1)}>−</button><span>{fontSize}</span><button className="icon-button" title={t("Larger font", "Tăng cỡ chữ")} aria-label={t("Increase terminal font size", "Tăng cỡ chữ terminal")} onClick={() => applyFontSize(fontSize + 1)}>+</button></div>
      <div className="terminal-search"><Icon name="search" size={13} /><input aria-label={t("Search terminal", "Tìm trong terminal")} value={query} onChange={(event) => { setQuery(event.target.value); searchFrom.current = 0; }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); find(); } }} placeholder={t("Search terminal…", "Tìm trong terminal…")} /><button className="text-button" onClick={find} disabled={!query}>{t("Find next", "Tìm tiếp")}</button></div>
      <div className="terminal-actions">{onHeightChange && <button className="text-button" aria-label={maximized ? 'Khôi phục cỡ terminal' : 'Phóng to terminal'} title={maximized ? 'Khôi phục cỡ terminal' : 'Phóng to terminal'} onClick={toggleMaximize}>{maximized ? 'Khôi phục' : 'Phóng to'}</button>}<button className="text-button" onClick={() => void copy()} title="Ctrl+Shift+C">{t("Copy", "Sao chép")}</button><button className="text-button" onClick={() => void paste()} title="Ctrl+Shift+V">{t("Paste", "Dán")}</button></div>
      {notice && <span className="terminal-flash" role="status">{notice}</span>}
      <span className="terminal-spacer" />
      <div className="terminal-actions">{hideable && <button className="text-button terminal-hide" title={t('Hide keeps the process running in the background.', 'Ẩn giữ tiến trình chạy nền.')} onClick={() => setBodyHidden(value => !value)}>{bodyHidden ? t('Show terminal', 'Hiện terminal') : t('Hide terminal', 'Ẩn terminal')}</button>}<button className={`action-btn${hideable ? ' terminal-end' : ''}`} title={closeTitle ?? (hideable ? undefined : t('Hide keeps the process running in the background.', 'Ẩn giữ tiến trình chạy nền.'))} onClick={onClose}>{closeLabel === 'Ẩn' ? t("Hide", "Ẩn") : closeLabel}</button></div>
    </div>
    {socketError && <div className="terminal-reconnect banner banner-error" role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, margin: '0 0 10px' }}><span>{socketError}</span><button className="action-btn" type="button" onClick={() => { setSocketError(null); setConnection(t("Connecting", "Đang kết nối")); setReconnectKey((key) => key + 1); }}>{t("Reconnect", "Kết nối lại")}</button></div>}
    <div className="terminal-host" hidden={bodyHidden} ref={containerRef} />
  </div>;
}
