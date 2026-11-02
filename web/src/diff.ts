/**
 * Unified-diff parsing for the Diff tab. Pure: the server sends one `patch`
 * string for the task and the UI splits it into a section per file, tagging
 * every line so the renderer only has to map a kind to a CSS class.
 */

export type DiffLineKind = 'add' | 'del' | 'ctx' | 'hunk';

export interface DiffLine {
  kind: DiffLineKind;
  /** Line content with the leading `+`/`-`/space marker removed. */
  text: string;
  /** Old-file line number, or null for added lines and hunk headers. */
  oldLine: number | null;
  /** New-file line number, or null for removed lines and hunk headers. */
  newLine: number | null;
}

export interface DiffSection {
  /** Path in the working tree (the `b/…` side), without the `a/`/`b/` prefix. */
  path: string;
  /** Source path, or null for a new file (`--- /dev/null`). */
  oldPath: string | null;
  added: number;
  removed: number;
  lines: DiffLine[];
}

const DIFF_PREFIX = 'diff --git ';
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Strip the `a/` or `b/` prefix git puts on diff header paths. */
function stripGitPrefix(value: string): string {
  return value.startsWith('a/') || value.startsWith('b/') ? value.slice(2) : value;
}

/**
 * Best-effort path from the `diff --git a/… b/…` line, used only when a
 * section has no `+++` line (for example a binary diff).
 */
function pathFromDiffLine(line: string): string {
  const rest = line.slice(DIFF_PREFIX.length);
  const marker = rest.indexOf(' b/');
  if (marker === -1) return stripGitPrefix(rest);
  return rest.slice(marker + 3);
}

/**
 * Split a `git diff` patch into per-file sections. File headers are consumed;
 * only hunk headers and hunk body lines end up in `lines` (kind `hunk`, `add`,
 * `del` or `ctx`). Lines before the first `diff --git` are ignored.
 */
export function splitPatch(patch: string): DiffSection[] {
  const sections: DiffSection[] = [];
  let current: DiffSection | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line.startsWith(DIFF_PREFIX)) {
      current = {
        path: pathFromDiffLine(line),
        oldPath: null,
        added: 0,
        removed: 0,
        lines: [],
      };
      sections.push(current);
      continue;
    }
    if (current === null) continue;

    // `--- `/`+++ ` only introduce a file's paths before its first hunk. Once a
    // hunk has started, a hunk line may itself begin with `+++ `/`--- ` and
    // must be read as content.
    const beforeHunk = current.lines.length === 0;

    if (beforeHunk && line.startsWith('--- ')) {
      const value = line.slice(4).trim();
      current.oldPath = value === '/dev/null' ? null : stripGitPrefix(value);
      continue;
    }
    if (beforeHunk && line.startsWith('+++ ')) {
      const value = line.slice(4).trim();
      if (value !== '/dev/null') current.path = stripGitPrefix(value);
      else if (current.oldPath !== null) current.path = current.oldPath;
      continue;
    }
    if (line.startsWith('@@')) {
      const match = HUNK_RE.exec(line);
      if (match) {
        oldNo = Number(match[1]);
        newNo = Number(match[2]);
      }
      current.lines.push({ kind: 'hunk', text: line, oldLine: null, newLine: null });
      continue;
    }

    // `index …`, `new file mode …`, `Binary files … differ` and friends come
    // before the first hunk and carry no line kind of their own.
    if (current.lines.length === 0) continue;

    if (line.startsWith('+')) {
      current.lines.push({ kind: 'add', text: line.slice(1), oldLine: null, newLine: newNo });
      newNo += 1;
      current.added += 1;
    } else if (line.startsWith('-')) {
      current.lines.push({ kind: 'del', text: line.slice(1), oldLine: oldNo, newLine: null });
      oldNo += 1;
      current.removed += 1;
    } else if (line.startsWith(' ')) {
      current.lines.push({ kind: 'ctx', text: line.slice(1), oldLine: oldNo, newLine: newNo });
      oldNo += 1;
      newNo += 1;
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — keep it visible but neutral.
      current.lines.push({ kind: 'ctx', text: line, oldLine: null, newLine: null });
    }
  }

  return sections;
}
