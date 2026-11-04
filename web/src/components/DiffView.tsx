import { useMemo, useState } from 'react';

import type { DiffFile } from '../../../shared/types.js';
import { splitPatch, type DiffSection } from '../diff.js';
import { isDesktop, openLocation } from '../desktop.js';
import { Icon } from './Icon.js';
import { Skeleton } from './Skeleton.js';

export interface DiffViewProps {
  files: DiffFile[];
  patch: string;
  error?: string | null;
  taskId?: string;
  /** True while the patch is being read; the empty copy must wait for it. */
  loading?: boolean;
  onRetry?: () => void;
}

function lineMarker(kind: DiffSection['lines'][number]['kind']): string {
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

/**
 * File list plus the unified diff of the selected file. The patch arrives as
 * one string and is split per file by `splitPatch`; each line is colored by
 * its kind (add/del/ctx/hunk).
 */
export function DiffView({ files, patch, error, taskId, loading = false, onRetry }: DiffViewProps) {
  const sections = useMemo(() => splitPatch(patch), [patch]);
  const [chosenPath, setSelectedPath] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  // Derived, not synced in an effect: the first file is shown until the user picks another.
  const selectedPath =
    chosenPath !== null && files.some((file) => file.path === chosenPath)
      ? chosenPath
      : files[0]?.path ?? null;

  // A failed read must offer a way out instead of an empty panel.
  if (error !== undefined && error !== null) {
    return (
      <div className="banner banner-error" role="alert">
        Không tải được thay đổi: {error}
        {onRetry && <button type="button" className="banner-retry" onClick={onRetry}>Thử lại</button>}
      </div>
    );
  }

  if (loading && files.length === 0) {
    return <Skeleton className="diff-skeleton" label="Đang tải thay đổi…" lines={6} />;
  }

  if (files.length === 0) {
    return <div className="placeholder">Chưa có thay đổi.</div>;
  }

  const section = sections.find((entry) => entry.path === selectedPath) ?? null;

  return (
    <div className="diff-view">
      <ul className="diff-files">
        {files.map((file) => (
          <li key={file.path}>
            <button
              type="button"
              className={`diff-file${file.path === selectedPath ? ' selected' : ''}`}
              onClick={() => setSelectedPath(file.path)}
              title={file.path}
            >
              <span className="diff-file-path">{file.path}</span>
              <span className="diff-stat">
                <span className="diff-added">+{file.added}</span>
                <span className="diff-removed">-{file.removed}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="diff-detail"><div className="diff-toolbar"><span>{selectedPath}</span><button className="text-button" disabled={!isDesktop() || !taskId || !selectedPath} title={isDesktop() ? 'Hiện tệp trong Explorer' : 'Có trong ứng dụng Desktop'} onClick={() => { if (taskId && selectedPath) void openLocation({ taskId, relativePath: selectedPath, action: 'reveal' }).catch((cause) => setLocationError(String(cause))); }}><Icon name="folder" size={14} />Mở vị trí tệp</button></div>{locationError && <p className="banner banner-error">{locationError}</p>}<div className="diff-pane">
        {section === null ? (
          <div className="placeholder">Không có thay đổi cho tệp này.</div>
        ) : (
          section.lines.map((line, index) => (
            <div key={index} className={`diff-line diff-${line.kind}`}>
              <span className="diff-gutter">
                {line.oldLine ?? ''}
              </span>
              <span className="diff-gutter">
                {line.newLine ?? ''}
              </span>
              <span className="diff-marker">{lineMarker(line.kind)}</span>
              <span className="diff-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
      </div>
    </div>
  );
}
