import { describe, expect, test } from 'vitest';

import { splitPatch } from '../../web/src/diff.js';

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
