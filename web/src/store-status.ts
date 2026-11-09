import type { TaskStatus } from '../../shared/types.js';
import type { MergeResult } from './api.js';
import type { IconName } from './components/Icon.js';

// ── status display ──────────────────────────────────────────────────────────

/**
 * Status glyphs are lucide icon names, never Unicode symbols: the old `◐ ○ ⑂ ⏱`
 * characters render unevenly in Segoe UI and carry no accessible name.
 */
const STATUS_META: Record<TaskStatus, { label: string; icon: IconName }> = {
  queued: { label: 'đang chờ', icon: 'status-queued' },
  running: { label: 'đang chạy', icon: 'status-running' },
  done: { label: 'xong', icon: 'status-done' },
  failed: { label: 'lỗi', icon: 'status-failed' },
  timeout: { label: 'quá hạn', icon: 'status-timeout' },
  interrupted: { label: 'bị dừng', icon: 'status-interrupted' },
  taken_over: { label: 'tiếp quản', icon: 'status-taken-over' },
  merged: { label: 'đã merge', icon: 'status-merged' },
  discarded: { label: 'đã huỷ', icon: 'status-discarded' },
};

export function statusLabel(status: TaskStatus): string {
  return STATUS_META[status].label;
}

export function statusIcon(status: TaskStatus): IconName {
  return STATUS_META[status].icon;
}

// ── task actions ────────────────────────────────────────────────────────────

/** Action buttons the detail panel offers for a task status. */
export type TaskAction = 'stop' | 'markDone' | 'merge' | 'discard';

/**
 * Which actions apply to a status:
 * running → Dừng; taken_over → Đánh dấu xong; done/failed/timeout/interrupted
 * → Huỷ; only done offers Merge. Queued/merged/discarded → none.
 */
export function taskActions(status: TaskStatus): TaskAction[] {
  switch (status) {
    case 'running':
      return ['stop'];
    case 'taken_over':
      return ['markDone'];
    case 'done':
      return ['merge', 'discard'];
    case 'failed':
    case 'timeout':
    case 'interrupted':
      return ['discard'];
    default:
      return [];
  }
}

/** Vietnamese message for a rejected merge, including the base branch name. */
export function mergeErrorMessage(result: MergeResult, baseBranch: string): string {
  if (result.ok) return '';
  switch (result.reason) {
    case 'error':
      return `Merge lỗi: ${result.message ?? ''}`;
    case 'dirty':
      return 'Repo gốc còn thay đổi chưa commit';
    case 'wrong_branch':
      return `Repo gốc không ở nhánh ${baseBranch}`;
    case 'conflict': {
      const files = result.files ?? [];
      return files.length > 0 ? `Xung đột: ${files.join(', ')}` : 'Xung đột';
    }
  }
}
