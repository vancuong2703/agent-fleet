import { spawn, type IPty } from '@lydell/node-pty';

/** An already-resolved command for a task's terminal. */
export interface PtyTarget {
  cmd: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
}

/** Resolves the command a task's terminal should run (adapter `interactive()`). */
export type PtyResolver = (taskId: string) => PtyTarget;

/**
 * One terminal attached to a task. Subscribers are decoupled from the PTY so a
 * WebSocket can detach and re-attach without killing the shell.
 */
export interface PtySession {
  /** Subscribe to output; the session's buffered output is replayed first. */
  onData(listener: (data: string) => void): () => void;
  /** Subscribe to exit; fires immediately if the process already exited. */
  onExit(listener: (code: number) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** How much scrollback a re-attaching client gets back. */
const MAX_BUFFER = 200 * 1024;

class NodePtySession implements PtySession {
  private readonly pty: IPty;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();
  private buffer = '\x1b[0m\x1b[49m';
  private exitCode: number | null = null;
  private cols: number;
  private rows: number;

  constructor(
    target: PtyTarget,
    cols: number,
    rows: number,
    private readonly onExited: (session: NodePtySession, code: number) => void,
  ) {
    this.cols = cols;
    this.rows = rows;
    this.pty = spawn(target.cmd, target.args, {
      cwd: target.cwd,
      cols,
      rows,
      name: 'xterm-256color',
      // Some CLIs (opencode) take PWD over the real cwd; keep it on the task's worktree.
      env: { ...process.env, PWD: target.cwd, TERM: 'xterm-256color', COLORTERM: 'truecolor', ...target.env },
    });

    this.pty.onData((chunk) => {
      this.buffer += chunk;
      if (this.buffer.length > MAX_BUFFER) {
        this.buffer = this.buffer.slice(this.buffer.length - MAX_BUFFER);
      }
      for (const listener of this.dataListeners) listener(chunk);
    });

    this.pty.onExit(({ exitCode }) => {
      this.exitCode = exitCode;
      this.onExited(this, exitCode);
      for (const listener of this.exitListeners) listener(exitCode);
    });
  }

  onData(listener: (data: string) => void): () => void {
    if (this.buffer.length > 0) listener(this.buffer);
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onExit(listener: (code: number) => void): () => void {
    const code = this.exitCode;
    if (code !== null) {
      queueMicrotask(() => listener(code));
      return () => {};
    }
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  write(data: string): void {
    if (this.exitCode === null) this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.exitCode !== null || cols <= 0 || rows <= 0 || (cols === this.cols && rows === this.rows)) return;
    this.cols = cols; this.rows = rows;
    this.pty.resize(cols, rows);
  }

  kill(): void {
    if (this.exitCode !== null) return;
    try {
      this.pty.kill();
    } catch {
      // The process may have exited between the check and the kill.
    }
  }
}

/**
 * Owns one PTY per task. Re-opening a task reuses the live session (the caller
 * is replayed the buffered output by `onData`), so switching tabs or reloading
 * the UI never kills the shell.
 */
export class PtyManager {
  private readonly sessions = new Map<string, NodePtySession>();

  constructor(private readonly resolve: PtyResolver) {}

  open(taskId: string, cols = 80, rows = 24): PtySession {
    return this.openTarget(taskId, this.sessions.has(taskId) ? undefined : this.resolve(taskId), cols, rows);
  }

  /** A server-owned command target for a dashboard terminal; never client argv. */
  openTarget(taskId: string, target: PtyTarget | undefined, cols = 80, rows = 24): PtySession {
    const existing = this.sessions.get(taskId);
    if (existing) {
      existing.resize(cols, rows);
      return existing;
    }
    if (!target) throw new Error(`Missing terminal target: ${taskId}`);
    const session = new NodePtySession(target, cols, rows, (exited) => {
      // A dead shell frees the slot so the next open starts a fresh one.
      if (this.sessions.get(taskId) === exited) this.sessions.delete(taskId);
    });
    this.sessions.set(taskId, session);
    return session;
  }

  get(taskId: string): PtySession | undefined {
    return this.sessions.get(taskId);
  }

  async kill(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { off(); resolve(); }, 5_000);
      const off = session.onExit(() => { clearTimeout(timer); off(); resolve(); });
      session.kill();
    });
  }

  /** Kill every open terminal; used on server shutdown and in tests. */
  killAll(): void {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.kill();
  }
}
