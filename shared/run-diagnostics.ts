import type { Run, TaskResult } from './types.js';

/** Includes checks for runs created by older servers that reported done. */
export function successfulResult(result: TaskResult): boolean {
  return result.task.status === 'done'
    && result.run?.checkPassed !== false
    && !result.run?.errorCategory;
}

export function runDiagnostic(run: Run | null): string | null {
  if (run?.errorCategory === 'permission') {
    return 'Agent bị từ chối quyền chạy lệnh. Mở terminal để tiếp tục phiên và duyệt quyền, hoặc cấp permissions.allow cho đúng lệnh rồi retry.';
  }
  if (run?.checkPassed === false || run?.errorCategory === 'check') {
    return 'Kiểm tra thất bại. Xem log check, sửa lỗi và retry trước khi merge.';
  }
  if (run?.errorCategory) return `Agent gặp lỗi (${run.errorCategory}). Xem log để xử lý và retry.`;
  return null;
}
