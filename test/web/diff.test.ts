import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { splitPatch } from '../../web/src/diff.js';
import { DiffView } from '../../web/src/components/DiffView.js';

const TWO_FILE_PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +1,4 @@',
  ' const x = 1;',
  '-const y = 2;',
  '+const y = 3;',
  '+const z = 4;',
  ' export {};',
  'diff --git a/README.md b/README.md',
  'index 3333333..4444444 100644',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1 @@',
  '-old',
  '+new',
].join('\n');

describe('splitPatch', () => {
  test('splits a multi-file patch into one section per file', () => {
    const sections = splitPatch(TWO_FILE_PATCH);

    expect(sections.map((section) => section.path)).toEqual(['src/a.ts', 'README.md']);
    expect(sections[0]).toMatchObject({ added: 2, removed: 1 });
    expect(sections[1]).toMatchObject({ added: 1, removed: 1 });
  });

  test('tags every hunk line with its kind and skips file headers', () => {
    const [first] = splitPatch(TWO_FILE_PATCH);

    expect(first?.lines.map((line) => line.kind)).toEqual([
      'hunk',
      'ctx',
      'del',
      'add',
      'add',
      'ctx',
    ]);
    expect(first?.lines[0]?.text).toContain('@@ -1,3 +1,4 @@');
  });

  test('keeps a path containing spaces intact', () => {
    const patch = [
      'diff --git a/dir/my file.txt b/dir/my file.txt',
      'index 1111111..2222222 100644',
      '--- a/dir/my file.txt',
      '+++ b/dir/my file.txt',
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ].join('\n');

    const sections = splitPatch(patch);

    expect(sections).toHaveLength(1);
    expect(sections[0]?.path).toBe('dir/my file.txt');
    expect(sections[0]?.oldPath).toBe('dir/my file.txt');
  });

  test('does not mistake hunk content that looks like a file header', () => {
    const patch = [
      'diff --git a/notes.txt b/notes.txt',
      '--- a/notes.txt',
      '+++ b/notes.txt',
      '@@ -1 +1,3 @@',
      '-old',
      '+++ not a header',
      '--- not an old header',
    ].join('\n');

    const [section] = splitPatch(patch);

    expect(section?.lines.map((line) => line.kind)).toEqual(['hunk', 'del', 'add', 'del']);
    expect(section?.lines[2]?.text).toBe('++ not a header');
    expect(section?.lines[3]?.text).toBe('-- not an old header');
  });

  test('marks a new file with a /dev/null source and counts only adds', () => {
    const patch = [
      'diff --git a/new file.txt b/new file.txt',
      'new file mode 100644',
      'index 0000000..abcdef1',
      '--- /dev/null',
      '+++ b/new file.txt',
      '@@ -0,0 +1,2 @@',
      '+hello',
      '+world',
    ].join('\n');

    const sections = splitPatch(patch);

    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({
      path: 'new file.txt',
      oldPath: null,
      added: 2,
      removed: 0,
    });
    expect(sections[0]?.lines.filter((line) => line.kind === 'add')).toHaveLength(2);
  });

  test('returns nothing for an empty patch', () => {
    expect(splitPatch('')).toEqual([]);
  });
});

describe('DiffView rendering', () => {
  const makeFiles = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      path: `src/file-${index}.ts`,
      added: index + 1,
      removed: index,
    }));

  const makePatch = (count: number) =>
    makeFiles(count)
      .map(
        (file) =>
          `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1,1 +1,2 @@\n-old line\n+new line 1\n+new line 2\n`,
      )
      .join('');

  const renderDiff = (props: Partial<Parameters<typeof DiffView>[0]> = {}) => {
    const defaultProps = {
      files: makeFiles(2),
      patch: makePatch(2),
      taskId: 't-test-1',
      worktreePath: 'C:\\test\\worktree',
    };
    return renderToStaticMarkup(createElement(DiffView, { ...defaultProps, ...props }));
  };

  test('renders each file inside its own .diff-section card container with header and toggle', () => {
    const html = renderDiff({ files: makeFiles(2), patch: makePatch(2) });

    expect(html).toContain('class="diff-pane"');
    expect(html.match(/<section class="diff-section/g)).toHaveLength(2);
    expect(html.match(/class="diff-section-head"/g)).toHaveLength(2);
    expect(html.match(/class="diff-toggle"/g)).toHaveLength(2);
    expect(html.match(/class="diff-chevron"/g)).toHaveLength(2);
    expect(html).toContain('src/file-0.ts');
    expect(html).toContain('src/file-1.ts');
  });

  test('defaults to aria-expanded="true" for small diffs (<= 3 files) and mounts .diff-body-wrap', () => {
    const html = renderDiff({ files: makeFiles(3), patch: makePatch(3) });

    // All 3 sections are open
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(3);
    expect(html.match(/class="diff-section open"/g)).toHaveLength(3);
    expect(html.match(/class="diff-body-wrap"/g)).toHaveLength(3);
    expect(html.match(/class="diff-body"/g)).toHaveLength(3);
    expect(html).toContain('Thu gọn tất cả');
  });

  test('defaults to only first file open for diffs > 3 files, collapsing the rest without body DOM', () => {
    const html = renderDiff({ files: makeFiles(5), patch: makePatch(5) });

    expect(html.match(/<section class="diff-section/g)).toHaveLength(5);
    // Only 1 is open (aria-expanded="true"), 4 are collapsed (aria-expanded="false")
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(4);

    // Only open file has .diff-body-wrap and .diff-body
    expect(html.match(/class="diff-body-wrap"/g)).toHaveLength(1);
    expect(html.match(/class="diff-body"/g)).toHaveLength(1);
    expect(html).toContain('src/file-0.ts');
    expect(html).toContain('Mở rộng tất cả');
  });

  test('renders .diff-chevron with icon in each toggle button', () => {
    const html = renderDiff({ files: makeFiles(1), patch: makePatch(1) });

    expect(html).toContain('class="diff-chevron"');
    // SVG chevron inside the span
    expect(html).toMatch(/<span class="diff-chevron">\s*<svg/);
  });

  test('preserves error banner when error prop is provided', () => {
    const html = renderDiff({ error: 'Git diff failed: disk full' });

    expect(html).toContain('class="banner banner-error"');
    expect(html).toContain('Git diff failed: disk full');
  });

  test('renders skeleton when loading with no files', () => {
    const html = renderDiff({ files: [], loading: true });

    expect(html).toContain('diff-skeleton');
  });

  test('renders placeholder when no files and not loading', () => {
    const html = renderDiff({ files: [], loading: false });

    expect(html).toContain('class="placeholder"');
    expect(html).toContain('Chưa có thay đổi.');
  });
});
