import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

export interface TerminalPanelProps {
  taskId: string;
  onClose: () => void;
}

type ServerMessage = { t: 'out'; d: string } | { t: 'exit'; code: number };

/**
 * Live xterm.js terminal attached to the server's PTY for one task
 * (`WS /ws/pty`). Same-origin, so the `fleet_token` cookie authenticates the
 * upgrade. Protocol: server `{t:'out',d}` / `{t:'exit',code}`, client
 * `{t:'in',d}` / `{t:'resize',cols,rows}`.
 */
export function TerminalPanel({ taskId, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 12,
      scrollback: 2_000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${scheme}://${window.location.host}/ws/pty?taskId=${encodeURIComponent(taskId)}&cols=${term.cols}&rows=${term.rows}`;
    const socket = new WebSocket(url);

    const sendResize = (): void => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ t: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    socket.onopen = () => {
      fit.fit();
      sendResize();
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.t === 'out') term.write(message.d);
        else if (message.t === 'exit') term.write(`\r\n\x1b[90m[phiên đã kết thúc, mã ${message.code}]\x1b[0m\r\n`);
      } catch {
        // Ignore a malformed frame; the next one still arrives.
      }
    };

    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'in', d: data }));
    });

    const observer = new ResizeObserver(() => {
      fit.fit();
      sendResize();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      input.dispose();
      socket.close();
      term.dispose();
    };
  }, [taskId]);

  return (
    <div className="terminal-panel">
      <div className="terminal-head">
        <span className="terminal-title">Terminal · {taskId}</span>
        <button type="button" className="action-btn" onClick={onClose}>
          Đóng
        </button>
      </div>
      <div className="terminal-host" ref={containerRef} />
    </div>
  );
}
