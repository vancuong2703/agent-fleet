import { useEffect, useState } from 'react';

import type { Task } from '../../../shared/types.js';
import { api } from '../api.js';
import { mergeErrorMessage, taskActions } from '../store.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { TerminalPanel } from './TerminalPanel.js';

export interface TaskActionsProps {
  task: Task;
  baseBranch: string;
}

type Pending = 'merge' | 'discard' | 'terminal' | null;

/**
 * Action bar for the selected task. Dừng and Đánh dấu xong fire immediately;
 * Merge, Huỷ and terminal takeover go through an in-page `ConfirmDialog`.
 * Merge failures are translated to Vietnamese and shown above the buttons.
 */
export function TaskActions({ task, baseBranch }: TaskActionsProps) {
  const actions = taskActions(task.status);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Switching tasks never leaves the previous task's terminal mounted.
  useEffect(() => {
    setTerminalOpen(false);
  }, [task.id]);

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
            disabled={busy}
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

        {message !== null && <span className="action-message">{message}</span>}
      </div>

      {terminalOpen && (
        <TerminalPanel taskId={task.id} onClose={() => setTerminalOpen(false)} />
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
