import { useMemo, useState } from 'react';

import type { DiffFile } from '../../../shared/types.js';
import { splitPatch, type DiffSection } from '../diff.js';

export interface DiffViewProps {
  files: DiffFile[];
  patch: string;
  error?: string | null;
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
export function DiffView({ files, patch, error }: DiffViewProps) {
  const sections = useMemo(() => splitPatch(patch), [patch]);
  const [chosenPath, setSelectedPath] = useState<string | null>(null);
  // Derived, not synced in an effect: the first file is shown until the user picks another.
  const selectedPath =
    chosenPath !== null && files.some((file) => file.path === chosenPath)
      ? chosenPath
      : files[0]?.path ?? null;

  if (error !== undefined && error !== null) {
    return <div className="banner banner-error">{error}</div>;
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
      <div className="diff-pane">
        {section === null ? (
          <div className="placeholder">Không có diff cho file này.</div>
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
  );
}