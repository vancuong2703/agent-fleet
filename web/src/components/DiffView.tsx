import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { DiffFile } from '../../../shared/types.js';
import { splitPatch, type DiffLine } from '../diff.js';
import { copyText, errorMessage, isDesktop, joinWorktreePath, openLocation } from '../desktop.js';
import { useLanguage } from '../ui/language.js';
import { Icon } from './Icon.js';
import { Skeleton } from './Skeleton.js';

export interface DiffViewProps {
  files: DiffFile[];
  patch: string;
  error?: string | null;
  taskId?: string;
  /** Worktree folder of the task; worktree + relative path is the value "copy path" puts on the clipboard. */
  worktreePath?: string;
  /** True while the patch is being read; the empty copy must wait for it. */
  loading?: boolean;
  onRetry?: () => void;
}

/** Up to this many files every section starts open; above it only the first does. */
export const DIFF_OPEN_ALL_LIMIT = 3;

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

function shouldSkipMotion(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return true;
  const pref = document.documentElement.dataset.motion;
  if (pref === 'reduced' || pref === 'off') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function lineMarker(kind: DiffLine['kind']): string {
  switch (kind) {
    case 'add':
      return '+';
    case 'del':
      return '-';
    case 'ctx':
      return ' ';
    case 'hunk':
      return '';
  }
}

/** Lines of one open file. Closed files never render this, which keeps big patches cheap. */
function DiffLines({ lines }: { lines: DiffLine[] }) {
  return (
    <>
      {lines.map((line, index) => (
        <div key={index} className={`diff-line diff-${line.kind}`}>
          <span className="diff-gutter">{line.oldLine ?? ''}</span>
          <span className="diff-gutter">{line.newLine ?? ''}</span>
          <span className="diff-marker">{lineMarker(line.kind)}</span>
          <span className="diff-text">{line.text}</span>
        </div>
      ))}
    </>
  );
}

/**
 * Per-file collapsible diff. The patch arrives as one string and is split per
 * file by `splitPatch`. Each file is a section with a sticky header (path, +/-,
 * reveal button); only open sections render their lines. Open/closed state is
 * keyed by path, so the 3 s polling refresh keeps what the user opened.
 */
export function DiffView({ files, patch, error, taskId, worktreePath, loading = false, onRetry }: DiffViewProps) {
  const { t } = useLanguage();
  const sections = useMemo(() => new Map(splitPatch(patch).map((section) => [section.path, section])), [patch]);
  // Default is decided once, from the first non-empty file list: all open for a
  // small change, otherwise only the first file. A later poll never flips it.
  const defaults = useRef<{ all: boolean; first: string } | null>(null);
  if (defaults.current === null && files.length > 0) defaults.current = { all: files.length <= DIFF_OPEN_ALL_LIMIT, first: files[0]!.path };

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [closing, setClosing] = useState<Record<string, boolean>>({});
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  const activeAnims = useRef<Map<string, Animation>>(new Map());
  const bodyWrapRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const toggleRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  const allToggleRef = useRef<HTMLButtonElement | null>(null);
  const pendingOpenings = useRef<Set<string>>(new Set());
  const prevTaskIdRef = useRef<string | undefined>(taskId);

  const isCollapsed = (path: string): boolean => {
    if (path in collapsed) return collapsed[path] === true;
    if (defaults.current !== null) {
      return defaults.current.all ? false : defaults.current.first !== path;
    }
    return false;
  };

  const isOpen = (path: string): boolean => !isCollapsed(path);

  useEffect(() => {
    if (prevTaskIdRef.current !== taskId) {
      prevTaskIdRef.current = taskId;
      for (const anim of activeAnims.current.values()) {
        try { anim.cancel(); } catch { /* ignore */ }
      }
      activeAnims.current.clear();
      pendingOpenings.current.clear();
      defaults.current = null;
      setCollapsed({});
      setClosing({});
    }
  }, [taskId]);

  useEffect(() => {
    return () => {
      for (const anim of activeAnims.current.values()) {
        try { anim.cancel(); } catch { /* ignore */ }
      }
      activeAnims.current.clear();
      pendingOpenings.current.clear();
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    if (pendingOpenings.current.size === 0) return;
    const paths = Array.from(pendingOpenings.current);
    pendingOpenings.current.clear();

    if (shouldSkipMotion()) return;

    for (const path of paths) {
      const wrapEl = bodyWrapRefs.current.get(path);
      if (!wrapEl || typeof wrapEl.animate !== 'function') continue;

      const running = activeAnims.current.get(path);
      if (running) {
        try { running.cancel(); } catch { /* ignore */ }
        activeAnims.current.delete(path);
      }

      const targetHeight = wrapEl.scrollHeight || wrapEl.getBoundingClientRect().height;
      if (targetHeight <= 0) continue;

      try {
        const anim = wrapEl.animate(
          [
            { height: '0px', opacity: 0 },
            { height: `${targetHeight}px`, opacity: 1 },
          ],
          { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
        activeAnims.current.set(path, anim);

        anim.onfinish = () => {
          if (activeAnims.current.get(path) === anim) {
            activeAnims.current.delete(path);
            wrapEl.style.height = '';
            wrapEl.style.opacity = '';
          }
        };

        anim.oncancel = () => {
          if (activeAnims.current.get(path) === anim) {
            activeAnims.current.delete(path);
            wrapEl.style.height = '';
            wrapEl.style.opacity = '';
          }
        };
      } catch {
        wrapEl.style.height = '';
        wrapEl.style.opacity = '';
      }
    }
  });

  // A failed read must offer a way out instead of an empty panel.
  if (error !== undefined && error !== null) {
    return (
      <div className="banner banner-error" role="alert">
        {t('Could not load the changes: ', 'Không tải được thay đổi: ')}{error}
        {onRetry && <button type="button" className="banner-retry" onClick={onRetry}>{t('Retry', 'Thử lại')}</button>}
      </div>
    );
  }

  if (loading && files.length === 0) {
    return <Skeleton className="diff-skeleton" label={t('Loading changes…', 'Đang tải thay đổi…')} lines={6} />;
  }

  if (files.length === 0) {
    return <div className="placeholder">{t('No changes yet.', 'Chưa có thay đổi.')}</div>;
  }

  const allOpen = files.every((file) => isOpen(file.path));

  const toggleFile = (path: string): void => {
    const currentlyOpen = isOpen(path);

    if (currentlyOpen) {
      const wrapEl = bodyWrapRefs.current.get(path);

      if (typeof document !== 'undefined' && wrapEl && document.activeElement && wrapEl.contains(document.activeElement)) {
        toggleRefs.current.get(path)?.focus();
      }

      if (shouldSkipMotion() || !wrapEl || typeof wrapEl.animate !== 'function') {
        const running = activeAnims.current.get(path);
        if (running) {
          try { running.cancel(); } catch { /* ignore */ }
          activeAnims.current.delete(path);
        }
        setCollapsed((current) => ({ ...current, [path]: true }));
        setClosing((current) => ({ ...current, [path]: false }));
        if (wrapEl) {
          wrapEl.style.height = '';
          wrapEl.style.opacity = '';
        }
        return;
      }

      const running = activeAnims.current.get(path);
      if (running) {
        try { running.cancel(); } catch { /* ignore */ }
        activeAnims.current.delete(path);
      }

      const startHeight = wrapEl.getBoundingClientRect().height;
      if (startHeight <= 0) {
        setCollapsed((current) => ({ ...current, [path]: true }));
        setClosing((current) => ({ ...current, [path]: false }));
        return;
      }

      setCollapsed((current) => ({ ...current, [path]: true }));
      setClosing((current) => ({ ...current, [path]: true }));

      try {
        const anim = wrapEl.animate(
          [
            { height: `${startHeight}px`, opacity: 1 },
            { height: '0px', opacity: 0 },
          ],
          { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
        );
        activeAnims.current.set(path, anim);

        anim.onfinish = () => {
          if (activeAnims.current.get(path) === anim) {
            activeAnims.current.delete(path);
            wrapEl.style.height = '';
            wrapEl.style.opacity = '';
            setClosing((current) => ({ ...current, [path]: false }));
          }
        };

        anim.oncancel = () => {
          if (activeAnims.current.get(path) === anim) {
            activeAnims.current.delete(path);
            wrapEl.style.height = '';
            wrapEl.style.opacity = '';
          }
        };
      } catch {
        setClosing((current) => ({ ...current, [path]: false }));
      }
    } else {
      const running = activeAnims.current.get(path);
      if (running) {
        try { running.cancel(); } catch { /* ignore */ }
        activeAnims.current.delete(path);
      }

      setClosing((current) => ({ ...current, [path]: false }));
      setCollapsed((current) => ({ ...current, [path]: false }));

      if (!shouldSkipMotion()) {
        pendingOpenings.current.add(path);
      }
    }
  };

  const collapseAll = (nextOpen: boolean): void => {
    for (const anim of activeAnims.current.values()) {
      try { anim.cancel(); } catch { /* ignore */ }
    }
    activeAnims.current.clear();
    pendingOpenings.current.clear();

    if (!nextOpen && typeof document !== 'undefined' && document.activeElement) {
      let insideAny = false;
      for (const wrapEl of bodyWrapRefs.current.values()) {
        if (wrapEl && wrapEl.contains(document.activeElement)) {
          insideAny = true;
          break;
        }
      }
      if (insideAny) {
        if (allToggleRef.current) {
          allToggleRef.current.focus();
        } else if (files[0]) {
          toggleRefs.current.get(files[0].path)?.focus();
        }
      }
    }

    if (files.length > 4 || shouldSkipMotion()) {
      setClosing({});
      setCollapsed(Object.fromEntries(files.map((file) => [file.path, !nextOpen])));
      return;
    }

    if (!nextOpen) {
      const newClosing: Record<string, boolean> = {};
      const newCollapsed: Record<string, boolean> = {};

      for (const file of files) {
        newCollapsed[file.path] = true;
        const currentlyOpen = isOpen(file.path);
        const wrapEl = bodyWrapRefs.current.get(file.path);
        if (currentlyOpen && wrapEl && typeof wrapEl.animate === 'function') {
          const startHeight = wrapEl.getBoundingClientRect().height;
          if (startHeight > 0) {
            newClosing[file.path] = true;
            try {
              const anim = wrapEl.animate(
                [
                  { height: `${startHeight}px`, opacity: 1 },
                  { height: '0px', opacity: 0 },
                ],
                { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
              );
              activeAnims.current.set(file.path, anim);

              anim.onfinish = () => {
                if (activeAnims.current.get(file.path) === anim) {
                  activeAnims.current.delete(file.path);
                  wrapEl.style.height = '';
                  wrapEl.style.opacity = '';
                  setClosing((cur) => ({ ...cur, [file.path]: false }));
                }
              };

              anim.oncancel = () => {
                if (activeAnims.current.get(file.path) === anim) {
                  activeAnims.current.delete(file.path);
                  wrapEl.style.height = '';
                  wrapEl.style.opacity = '';
                }
              };
            } catch {
              newClosing[file.path] = false;
            }
          }
        }
      }
      setCollapsed(newCollapsed);
      setClosing(newClosing);
    } else {
      setClosing({});
      setCollapsed(Object.fromEntries(files.map((file) => [file.path, false])));
      for (const file of files) {
        if (!isOpen(file.path)) {
          pendingOpenings.current.add(file.path);
        }
      }
    }
  };

  const clearError = (path: string): void => setFileErrors((current) => {
    if (!(path in current)) return current;
    const { [path]: _gone, ...rest } = current;
    return rest;
  });

  const copyPath = async (path: string): Promise<void> => {
    const value = worktreePath ? joinWorktreePath(worktreePath, path) : path;
    try {
      await copyText(value);
      setCopied(path);
      clearError(path);
      window.setTimeout(() => setCopied((current) => (current === path ? null : current)), 2_500);
    } catch (cause) {
      setFileErrors((current) => ({ ...current, [path]: t(`Could not copy the path: ${errorMessage(cause)}`, `Không sao chép được đường dẫn: ${errorMessage(cause)}`) }));
    }
  };

  const reveal = async (path: string): Promise<void> => {
    if (!taskId) return;
    clearError(path);
    try {
      await openLocation({ taskId, relativePath: path, action: 'reveal' });
    } catch (cause) {
      setFileErrors((current) => ({ ...current, [path]: errorMessage(cause) }));
    }
  };

  const desktop = isDesktop();
  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);

  return (
    <div className="diff-view">
      <div className="diff-toolbar">
        <span className="diff-summary">
          {files.length} {t(files.length === 1 ? 'file' : 'files', 'tệp')}
          <span className="diff-stat"><span className="diff-added">+{totalAdded}</span><span className="diff-removed">-{totalRemoved}</span></span>
        </span>
        {files.length > 1 && (
          <button ref={allToggleRef} type="button" className="text-button" onClick={() => collapseAll(!allOpen)}>
            {allOpen ? t('Collapse all', 'Thu gọn tất cả') : t('Expand all', 'Mở rộng tất cả')}
          </button>
        )}
      </div>
      <div className="diff-pane">
        {files.map((file) => {
          const open = isOpen(file.path);
          const isClosing = closing[file.path] === true;
          const showBody = open || isClosing;
          const section = sections.get(file.path) ?? null;
          const bodyId = `diff-body-${files.indexOf(file)}`;
          const failure = fileErrors[file.path];

          return (
            <section key={file.path} className={`diff-section${open ? ' open' : ''}`}>
              <div className="diff-section-head">
                <button
                  ref={(el) => {
                    if (el) toggleRefs.current.set(file.path, el);
                    else toggleRefs.current.delete(file.path);
                  }}
                  type="button"
                  className="diff-toggle"
                  aria-expanded={open}
                  aria-controls={open ? bodyId : undefined}
                  onClick={() => toggleFile(file.path)}
                  title={file.path}
                >
                  <span className="diff-chevron">
                    <Icon name="chevron-down" size={14} />
                  </span>
                  <span className="diff-file-path">{file.path}</span>
                  <span className="diff-stat">
                    <span className="diff-added">+{file.added}</span>
                    <span className="diff-removed">-{file.removed}</span>
                  </span>
                </button>
                {desktop ? (
                  <button
                    type="button"
                    className="text-button diff-reveal"
                    aria-label={t('Reveal file in Explorer', 'Mở vị trí tệp')}
                    disabled={!taskId}
                    title={t('Reveal file in Explorer', 'Hiện tệp trong Explorer')}
                    onClick={() => void reveal(file.path)}
                  >
                    <Icon name="folder" size={14} /><span className="diff-reveal-label">{t('Reveal', 'Mở vị trí tệp')}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button diff-reveal"
                    aria-label={t("Copy file path", "Sao chép đường dẫn")}
                    title={t("Opening a location needs the Desktop app. Copy the path instead.", "Mở vị trí chỉ có trong ứng dụng Desktop. Hãy sao chép đường dẫn.")}
                    onClick={() => void copyPath(file.path)}
                  >
                    <Icon name="copy" size={14} /><span className="diff-reveal-label">{copied === file.path ? t('Copied', 'Đã sao chép') : t("Copy path", "Sao chép đường dẫn")}</span>
                  </button>
                )}
              </div>
              {failure !== undefined && (
                <div className="banner banner-error diff-file-error" role="alert">
                  <span>{failure}</span>
                  <button type="button" className="banner-retry" onClick={() => void copyPath(file.path)}>{t("Copy path", "Sao chép đường dẫn")}</button>
                </div>
              )}
              {showBody && (
                <div
                  ref={(el) => {
                    if (el) bodyWrapRefs.current.set(file.path, el);
                    else bodyWrapRefs.current.delete(file.path);
                  }}
                  className="diff-body-wrap"
                >
                  <div className="diff-body" id={bodyId}>
                    {section === null ? <div className="placeholder">{t('No changes for this file.', 'Không có thay đổi cho tệp này.')}</div> : <DiffLines lines={section.lines} />}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
