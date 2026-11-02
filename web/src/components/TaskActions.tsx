import { useState } from 'react';

import type { Task } from '../../../shared/types.js';
import { api } from '../api.js';
import { mergeErrorMessage, taskActions } from '../store.js';
import { ConfirmDialog } from './ConfirmDialog.js';

export interface TaskActionsProps {
  task: Task;
  baseBranch: string;
}

type Pending = 'merge' | 'discard' | null;

/**
 * Action bar for the selected task. Dừng and Đánh dấu xong fire immediately;
 * Merge and Huỷ go through an in-page `ConfirmDialog`. Merge failures are
 * translated to Vietnamese and shown above the buttons.
 */
export function TaskActions({ task, baseBranch }: TaskActionsProps) {
  const actions = taskActions(task.status);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    return null;
  })();

  return (
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
      <button
        type="button"
        className="action-btn"
        disabled
        title="Sẽ có ở bước sau"
      >
        Mở terminal
      </button>

      {message !== null && <span className="action-message">{message}</span>}

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
