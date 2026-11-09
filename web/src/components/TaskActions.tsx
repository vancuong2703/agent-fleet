import { lazy, Suspense, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

import type { CommandPolicy, Run, Task } from '../../../shared/types.js';
import { api } from '../api.js';
import { mergeErrorMessage, taskActions } from '../store.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { useLanguage } from '../ui/language.js';
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
  const { t } = useLanguage();
  const actions = taskActions(task.status);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [retryOpen, setRetryOpen] = useState(false);
  const [retryNote, setRetryNote] = useState('Hoàn tất công việc và chạy lại kiểm tra.');
  const [retryPolicy, setRetryPolicy] = useState<CommandPolicy>(run?.commandPolicy ?? 'ask');
  const [retryAllowed, setRetryAllowed] = useState((run?.allowedCommands ?? []).join('\n'));
  const [resumeSession, setResumeSession] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const mergeReasonId = useId();
  const [diffRevision, setDiffRevision] = useState(0);
  const [mergeDiff, setMergeDiff] = useState<{ taskId: string; runId?: string; count: number | null; failed: boolean } | null>(null);

  // Switching tasks never leaves the previous task's terminal mounted.
  useEffect(() => {
    setTerminalOpen(false);
    setRetryOpen(false);
    setPending(null);
    setMenuOpen(false);
    setMessage(null);
    setRetryPolicy(run?.commandPolicy ?? 'ask');
    setRetryAllowed((run?.allowedCommands ?? []).join('\n'));
    setResumeSession(true);
  }, [task.id, run?.id]);

  useEffect(() => {
    let active = true;
    setMergeDiff(null);
    if (task.status === 'done') void api.diff(task.id).then(
      diff => { if (active) setMergeDiff({ taskId: task.id, runId: run?.id, count: diff.files.length, failed: false }); },
      () => { if (active) setMergeDiff({ taskId: task.id, runId: run?.id, count: null, failed: true }); },
    );
    return () => { active = false; };
  }, [task.id, task.status, run?.id, terminalOpen, diffRevision]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !menuButton.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen]);

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
        title: t('Merge this branch?', 'Merge nhánh này?'),
        message: t(`Merge ${task.branch} into ${baseBranch}?`, `Merge ${task.branch} vào ${baseBranch}?`),
        confirmLabel: 'Merge',
        danger: false,
        onConfirm: merge,
      };
    }
    if (pending === 'discard') {
      return {
        title: t('Discard this job?', 'Xoá công việc này?'),
        message: t('This deletes the worktree, branch and unmerged changes. Run history is kept.', 'Worktree, nhánh và mọi thay đổi chưa Merge của công việc sẽ bị xoá. Lịch sử vẫn được giữ lại.'),
        confirmLabel: t('Delete worktree and changes', 'Xoá worktree và thay đổi'),
        danger: true,
        onConfirm: () => invoke(() => api.discard(task.id)),
      };
    }
    if (pending === 'terminal') {
      return {
        title: t('Take over this terminal?', 'Tiếp quản terminal?'),
        message: t('The running agent will stop before opening the terminal. You can then work in its worktree.', 'Agent đang chạy sẽ bị dừng trước khi mở terminal. Công việc chuyển sang trạng thái tiếp quản để bạn thao tác trong worktree.'),
        confirmLabel: t('Stop agent and take over', 'Dừng agent và tiếp quản'),
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
  const currentDiff = mergeDiff?.taskId === task.id && mergeDiff.runId === run?.id ? mergeDiff : null;
  const mergeDisabledReason = busy ? 'Đang xử lý thao tác.'
    : run?.checkPassed === false ? 'Kiểm tra chưa đạt.'
    : run?.errorCategory ? 'Lần chạy có lỗi; hãy xử lý lỗi trước khi Merge.'
    : task.checkCmd && run?.checkPassed !== true ? 'Chưa có kết quả kiểm tra đạt.'
    : currentDiff?.failed ? 'Không đọc được thay đổi, chưa thể Merge.'
    : !currentDiff ? 'Đang tải thay đổi để kiểm tra Merge.'
    : currentDiff.count === 0 ? 'Không có thay đổi để Merge.' : null;

  return (
    <div className="task-actions-wrap">
      <div className="task-actions">
        <div className="task-actions-secondary">
          {terminalAvailable && (
            <button type="button" className={`action-btn${terminalOpen ? ' action-primary' : ''}`} disabled={busy} onClick={openTerminal}>
              {task.status === 'running' ? t('Take over terminal', 'Tiếp quản terminal') : t('Open CLI', 'Mở terminal')}
            </button>
          )}
          {['done', 'merged', 'failed', 'timeout', 'interrupted'].includes(task.status) && <button type="button" className="action-btn" disabled={busy} onClick={() => setRetryOpen((open) => !open)}>{task.status === 'merged' ? t('Continue', 'Tiếp tục') : t('Retry', 'Thử lại')}</button>}
          {actions.includes('discard') && <div className="task-overflow">
            <button ref={menuButton} type="button" className="action-btn task-overflow-trigger" aria-label="Thao tác khác" title="Thao tác khác" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined} disabled={busy}
              onClick={() => setMenuOpen(open => !open)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setMenuOpen(true); } }}>
              <MoreHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
            {menuOpen && <div ref={menu} id={menuId} role="menu" aria-label="Thao tác khác của công việc" className="task-overflow-menu" onKeyDown={event => {
              if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }
              if (event.key === 'Tab') { setMenuOpen(false); menuButton.current?.focus(); }
            }}>
              <button type="button" role="menuitem" tabIndex={-1} className="action-btn action-danger" onClick={() => { menuButton.current?.focus(); setMenuOpen(false); setPending('discard'); }}>{t('Discard job…', 'Huỷ công việc…')}</button>
            </div>}
          </div>}
        </div>
        <div className="task-actions-primary">
        {actions.includes('stop') && (
          <button
            type="button"
            className="action-btn action-primary"
            disabled={busy}
            onClick={() => invoke(() => api.stop(task.id))}
          >
            {t('Stop', 'Dừng')}
          </button>
        )}
        {actions.includes('markDone') && (
          <button
            type="button"
            className="action-btn action-primary"
            disabled={busy}
            onClick={() => invoke(() => api.markDone(task.id))}
          >
            {t('Mark done', 'Đánh dấu xong')}
          </button>
        )}
        {actions.includes('merge') && (
          <span className="merge-control" tabIndex={mergeDisabledReason ? 0 : undefined} title={mergeDisabledReason ?? undefined} aria-describedby={mergeDisabledReason ? mergeReasonId : undefined}><button
            type="button"
            className="action-btn action-primary"
            disabled={mergeDisabledReason !== null}
            title={mergeDisabledReason ?? 'Merge thay đổi vào nhánh gốc'}
            aria-describedby={mergeDisabledReason ? mergeReasonId : undefined}
            onClick={() => setPending('merge')}
          >
            Merge
          </button></span>
        )}
        </div>
      </div>
      {actions.includes('merge') && mergeDisabledReason && <div className="task-merge-help"><span id={mergeReasonId} role="tooltip">{mergeDisabledReason}</span>{currentDiff?.failed && !busy && <button type="button" className="text-button" onClick={() => setDiffRevision(value => value + 1)}>Tải lại thay đổi</button>}</div>}
      {message !== null && <p className="action-message" role="alert">{message}</p>}
      {retryOpen && <form className="retry-form" onSubmit={(event) => { event.preventDefault(); const allowed = retryAllowed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); void invoke(async () => { await api.retry(task.id, { note: retryNote, resumeSession: run?.sessionId ? resumeSession : false, ...(task.agent === 'agy' ? { commandPolicy: retryPolicy, ...(retryPolicy === 'check-only' && allowed.length > 0 ? { allowedCommands: allowed } : {}) } : {}) }); setRetryOpen(false); }); }}><label className="field">Ghi chú lần thử lại<textarea value={retryNote} required rows={2} onChange={(event) => setRetryNote(event.target.value)} /></label>{run?.sessionId && <label className="field-inline"><input type="checkbox" checked={resumeSession} onChange={(event) => setResumeSession(event.target.checked)} /><span>{t(`Keep previous session context (${run.sessionId.slice(0, 8)}…)`, `Giữ ngữ cảnh phiên trước (${run.sessionId.slice(0, 8)}…)`)}</span></label>}{task.agent === 'agy' && <div className="command-policy"><label className="field">Quyền lệnh cho lần thử này<select aria-label="Quyền lệnh AGY khi thử lại" value={retryPolicy} onChange={(event) => setRetryPolicy(event.target.value as CommandPolicy)}><option value="ask">Hỏi quyền theo mặc định của AGY</option><option value="check-only">Chỉ lệnh kiểm tra và danh sách cho phép</option><option value="auto">Tự duyệt lệnh terminal (chỉ phiên này)</option></select></label>{retryPolicy === 'check-only' && <label className="field">Lệnh được cho phép thêm<textarea rows={3} value={retryAllowed} onChange={(event) => setRetryAllowed(event.target.value)} placeholder={'npm test\nnode check.cjs'} /></label>}<p className="small-note">Dùng “Tự duyệt” khi lần trước thất bại vì AGY bị chặn quyền chạy lệnh. Quyền chỉ áp dụng phiên này và được ghi nhật ký.</p></div>}<button className="action-btn action-primary" disabled={busy} type="submit">Chạy lại agent</button></form>}

      {terminalOpen && (
        <Suspense fallback={<p className="small-note">Đang tải terminal…</p>}><TerminalPanel taskId={task.id} height={terminalHeight} onHeightChange={onTerminalHeight} onClose={() => setTerminalOpen(false)} /></Suspense>
      )}

      {confirm !== null && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          cancelLabel={t('Cancel', 'Huỷ bỏ')}
          danger={confirm.danger}
          busy={busy}
          onConfirm={confirm.onConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
