import { lazy, Suspense, useEffect, useState } from 'react';

import type { CommandPolicy, Run, Task } from '../../../shared/types.js';
import { api } from '../api.js';
import { mergeErrorMessage, taskActions } from '../store.js';
import { ConfirmDialog } from './ConfirmDialog.js';
const TerminalPanel = lazy(() => import('./TerminalPanel.js').then((module) => ({ default: module.TerminalPanel })));

export interface TaskActionsProps {
  task: Task;
  baseBranch: string;
  run?: Run | null;
  terminalHeight?: number;
  onTerminalHeight?: (height: number) => void;
}

type Pending = 'merge' | 'discard' | 'terminal' | null;

/**
 * Action bar for the selected task. Dừng and Đánh dấu xong fire immediately;
 * Merge, Huỷ and terminal takeover go through an in-page `ConfirmDialog`.
 * Merge failures are translated to Vietnamese and shown above the buttons.
 */
export function TaskActions({ task, baseBranch, run, terminalHeight, onTerminalHeight }: TaskActionsProps) {
  const actions = taskActions(task.status);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryNote, setRetryNote] = useState('Hoàn tất công việc và chạy lại kiểm tra.');
  const [retryPolicy, setRetryPolicy] = useState<CommandPolicy>(run?.commandPolicy ?? 'ask');
  const [retryAllowed, setRetryAllowed] = useState((run?.allowedCommands ?? []).join('\n'));

  // Switching tasks never leaves the previous task's terminal mounted.
  useEffect(() => {
    setTerminalOpen(false);
    setRetryOpen(false);
    setMessage(null);
    setRetryPolicy(run?.commandPolicy ?? 'ask');
    setRetryAllowed((run?.allowedCommands ?? []).join('\n'));
  }, [task.id, run?.id]);

  const fail = (cause: unknown): void => {
    setMessage(cause instanceof Error ? cause.message : String(cause));
  };

  const invoke = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const merge = (): Promise<void> =>
    invoke(async () => {
      const result = await api.merge(task.id);
      if (!result.ok) setMessage(mergeErrorMessage(result, baseBranch));
    });

  // A live agent must stop before the user takes the worktree over; a finished
  // task opens the shell without touching its status.
  const openTerminal = (): void => {
    if (task.status === 'running') setPending('terminal');
    else setTerminalOpen(true);
  };

  const confirm = (() => {
    if (pending === 'merge') {
      return {
        title: 'Merge nhánh này?',
        message: `Merge ${task.branch} vào ${baseBranch}?`,
        confirmLabel: 'Merge',
        danger: false,
        onConfirm: merge,
      };
    }
    if (pending === 'discard') {
      return {
        title: 'Huỷ task?',
        message: 'Worktree và nhánh của task sẽ bị xoá. Lịch sử vẫn được giữ lại.',
        confirmLabel: 'Huỷ',
        danger: true,
        onConfirm: () => invoke(() => api.discard(task.id)),
      };
    }
    if (pending === 'terminal') {
      return {
        title: 'Dừng agent đang chạy để tiếp quản?',
        message: 'Run headless sẽ bị dừng và task chuyển sang trạng thái tiếp quản.',
        confirmLabel: 'Tiếp quản',
        danger: false,
        onConfirm: () =>
          invoke(async () => {
            await api.takeover(task.id);
            setTerminalOpen(true);
          }),
      };
    }
    return null;
  })();

  const terminalAvailable = task.status !== 'queued' && task.status !== 'merged' && task.status !== 'discarded';

  return (
    <div className="task-actions-wrap">
      <div className="task-actions">
        {actions.includes('stop') && (
          <button
            type="button"
            className="action-btn"
            disabled={busy}
            onClick={() => invoke(() => api.stop(task.id))}
          >
            Dừng
          </button>
        )}
        {actions.includes('markDone') && (
          <button
            type="button"
            className="action-btn"
            disabled={busy}
            onClick={() => invoke(() => api.markDone(task.id))}
          >
            Đánh dấu xong
          </button>
        )}
        {actions.includes('merge') && (
          <button
            type="button"
            className="action-btn action-primary"
            disabled={busy || run?.checkPassed === false || Boolean(run?.errorCategory)}
            onClick={() => setPending('merge')}
          >
            Merge
          </button>
        )}
        {actions.includes('discard') && (
          <button
            type="button"
            className="action-btn action-danger"
            disabled={busy}
            onClick={() => setPending('discard')}
          >
            Huỷ
          </button>
        )}
        {terminalAvailable && (
          <button
            type="button"
            className={`action-btn${terminalOpen ? ' action-primary' : ''}`}
            disabled={busy}
            onClick={openTerminal}
          >
            Mở terminal
          </button>
        )}
        {['done', 'failed', 'timeout', 'interrupted'].includes(task.status) && <button type="button" className="action-btn" disabled={busy} onClick={() => setRetryOpen((open) => !open)}>Thử lại</button>}

        {message !== null && <span className="action-message">{message}</span>}
      </div>
      {retryOpen && <form className="retry-form" onSubmit={(event) => { event.preventDefault(); const allowed = retryAllowed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); void invoke(async () => { await api.retry(task.id, { note: retryNote, ...(task.agent === 'agy' ? { commandPolicy: retryPolicy, ...(retryPolicy === 'check-only' && allowed.length > 0 ? { allowedCommands: allowed } : {}) } : {}) }); setRetryOpen(false); }); }}><label className="field">Ghi chú lần thử lại<textarea value={retryNote} required rows={2} onChange={(event) => setRetryNote(event.target.value)} /></label>{task.agent === 'agy' && <div className="command-policy"><label className="field">Quyền lệnh cho lần thử này<select aria-label="Quyền lệnh AGY khi thử lại" value={retryPolicy} onChange={(event) => setRetryPolicy(event.target.value as CommandPolicy)}><option value="ask">Hỏi quyền theo mặc định của AGY</option><option value="check-only">Chỉ lệnh kiểm tra và danh sách cho phép</option><option value="auto">Tự duyệt lệnh terminal (chỉ phiên này)</option></select></label>{retryPolicy === 'check-only' && <label className="field">Lệnh được cho phép thêm<textarea rows={3} value={retryAllowed} onChange={(event) => setRetryAllowed(event.target.value)} placeholder={'npm test\nnode check.cjs'} /></label>}<p className="small-note">Dùng “Tự duyệt” khi lần trước thất bại vì AGY bị chặn quyền chạy lệnh. Quyền chỉ áp dụng phiên này và được ghi log.</p></div>}<button className="action-btn action-primary" disabled={busy} type="submit">Chạy lại agent</button></form>}

      {terminalOpen && (
        <Suspense fallback={<p className="small-note">Đang tải terminal…</p>}><TerminalPanel taskId={task.id} height={terminalHeight} onHeightChange={onTerminalHeight} onClose={() => setTerminalOpen(false)} /></Suspense>
      )}

      {confirm !== null && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          danger={confirm.danger}
          busy={busy}
          onConfirm={confirm.onConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
