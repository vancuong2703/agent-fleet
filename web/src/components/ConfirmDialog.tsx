import { useId, useLayoutEffect, useRef } from 'react';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation keeps keyboard focus inside the modal and returns it to its opener.
 * Destructive or pending actions cannot be dismissed through the backdrop.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Huỷ bỏ',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ busy, onCancel });
  latest.current = { busy, onCancel };
  const titleId = useId();
  const messageId = useId();

  useLayoutEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]',
    )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [aria-disabled="true"]')
      && !element.closest('[hidden], [inert], [aria-hidden="true"]')
      && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');
    const focusSafe = () => {
      const controls = focusable();
      const target = cancelRef.current && controls.includes(cancelRef.current) ? cancelRef.current : controls[0];
      (target ?? dialog).focus();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!latest.current.busy) latest.current.onCancel();
      } else if (event.key === 'Tab') {
        const controls = focusable();
        const first = controls[0];
        const last = controls.at(-1);
        const active = document.activeElement;
        if (!first || !last) {
          event.preventDefault();
          dialog.focus();
        } else if (!controls.includes(active as HTMLElement) || (!event.shiftKey && active === last) || (event.shiftKey && active === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }
    };
    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) focusSafe();
    };
    // Recompute after busy/hidden/disabled changes; never trap focus on a stale button list.
    const observer = new MutationObserver(() => {
      if (!focusable().includes(document.activeElement as HTMLElement)) focusSafe();
    });
    observer.observe(dialog, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'tabindex', 'style', 'class', 'aria-hidden', 'inert'] });
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', containFocus, true);
    focusSafe();
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', containFocus, true);
      document.body.style.overflow = previousOverflow;
      // Let the parent commit re-enabling an opener after an async operation first.
      queueMicrotask(() => { if (opener?.isConnected && !opener.matches(':disabled')) opener.focus(); });
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={(event) => { if (event.target === event.currentTarget && !danger && !busy) onCancel(); }}>
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} aria-busy={busy} tabIndex={-1}>
        <h3 className="modal-title" id={titleId}>{title}</h3>
        <p className="modal-message" id={messageId}>{message}</p>
        <div className="modal-actions">
          <button ref={cancelRef} type="button" className="action-btn" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`action-btn ${danger ? 'action-danger' : 'action-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
