import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { git, withRepoLock } from '../../server/git.js';
import {
  commitAll, createWorktree, currentBranch, diffWorktree, mergeBranch, removeWorktree,
} from '../../server/worktree.js';
import { makeTempRepo } from '../helpers/repo.js';

let repo: string;
let worktrees: string;
const roots: string[] = [];
const created: Array<{ path: string; branch: string }> = [];

async function checkedGit(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args);
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function create(id = 't-0001'): Promise<{ path: string; branch: string }> {
  const wt = { path: path.join(worktrees, id), branch: `fleet/test/${id}` };
  await createWorktree({ repoPath: repo, baseBranch: 'main', ...wt });
  created.push(wt);
  return wt;
}

beforeEach(async () => {
  repo = await makeTempRepo();
  roots.push(path.dirname(repo));
  worktrees = await mkdtemp(path.join(os.tmpdir(), 'fleet worktrees with space-'));
  roots.push(worktrees);
});

afterEach(async () => {
  // Unregister linked worktrees, then prune metadata before removing temp roots.
  for (const wt of created.splice(0)) {
    await checkedGit(repo, ['worktree', 'remove', '--force', wt.path]);
  }
  await checkedGit(repo, ['worktree', 'prune']);
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe('git worktree manager', () => {
  test('creates a worktree on the new branch in a path containing spaces', async () => {
    const wt = await create();
    await expect(access(wt.path)).resolves.toBeUndefined();
    expect(wt.path).toContain(' ');
    expect(repo).toContain('repo with space');
    expect(await currentBranch(wt.path)).toBe(wt.branch);
    expect(await currentBranch(repo)).toBe('main');
  });

  test('diffWorktree includes new and modified files with added/removed counts', async () => {
    const wt = await create();
    await writeFile(path.join(wt.path, 'new file.txt'), 'Xin chào\nSecond line\n');
    await writeFile(path.join(wt.path, 'README.md'), 'Changed line\n');
    const diff = await diffWorktree(wt.path, 'main');
    expect(diff.files).toEqual([
      { path: 'README.md', added: 1, removed: 1 },
      { path: 'new file.txt', added: 2, removed: 0 },
    ]);
    expect(diff.patch).toContain('-Original line');
    expect(diff.patch).toContain('+Changed line');
    expect(diff.patch).toContain('+Xin chào');
  });

  test('diffWorktree ignores commits added to the base after the fork', async () => {
    const wt = await create();
    await writeFile(path.join(wt.path, 'mine.txt'), 'mine\n');
    await writeFile(path.join(repo, 'other.txt'), 'merged elsewhere\n');
    await checkedGit(repo, ['add', '-A']);
    await checkedGit(repo, ['commit', '-m', 'other task']);
    const diff = await diffWorktree(wt.path, 'main');
    expect(diff.files.map((f) => f.path)).toEqual(['mine.txt']);
  });

  test('commitAll returns true then false when there is nothing left to commit', async () => {
    const wt = await create();
    await writeFile(path.join(wt.path, 'new.txt'), 'new\n');
    expect(await commitAll(wt.path, 'fleet: Sửa "lỗi"')).toBe(true);
    expect(await checkedGit(wt.path, ['log', '-1', '--format=%s'])).toBe('fleet: Sửa "lỗi"');
    expect(await commitAll(wt.path, 'fleet: no changes')).toBe(false);
    expect(await checkedGit(wt.path, ['status', '--porcelain'])).toBe('');
  });

  test('merges into main with a merge commit', async () => {
    const wt = await create();
    await writeFile(path.join(wt.path, 'new.txt'), 'merged\n');
    await commitAll(wt.path, 'fleet: new file');
    expect(await mergeBranch({ repoPath: repo, baseBranch: 'main', branch: wt.branch })).toEqual({ ok: true });
    expect(await readFile(path.join(repo, 'new.txt'), 'utf8')).toBe('merged\n');
    expect(await currentBranch(repo)).toBe('main');
    expect((await checkedGit(repo, ['rev-list', '--parents', '-n', '1', 'HEAD'])).split(' ')).toHaveLength(3);
  });

  test('refuses to merge when the original repo is dirty', async () => {
    const wt = await create();
    await writeFile(path.join(repo, 'untracked.txt'), 'keep me\n');
    expect(await mergeBranch({ repoPath: repo, baseBranch: 'main', branch: wt.branch }))
      .toEqual({ ok: false, reason: 'dirty' });
    expect(await readFile(path.join(repo, 'untracked.txt'), 'utf8')).toBe('keep me\n');
  });

  test('refuses to merge when the original repo is on another branch', async () => {
    const wt = await create();
    // Change the temporary repo's branch without checkout or branch commands.
    await checkedGit(repo, ['update-ref', 'refs/heads/other', 'HEAD']);
    await checkedGit(repo, ['symbolic-ref', 'HEAD', 'refs/heads/other']);
    expect(await mergeBranch({ repoPath: repo, baseBranch: 'main', branch: wt.branch }))
      .toEqual({ ok: false, reason: 'wrong_branch' });
    expect(await currentBranch(repo)).toBe('other');
  });

  test('aborts a conflicting merge, reports files, and leaves the repo clean', async () => {
    const first = await create('t-0001');
    const second = await create('t-0002');
    await writeFile(path.join(first.path, 'README.md'), 'First task\n');
    await writeFile(path.join(second.path, 'README.md'), 'Second task\n');
    await commitAll(first.path, 'fleet: first');
    await commitAll(second.path, 'fleet: second');
    expect(await mergeBranch({ repoPath: repo, baseBranch: 'main', branch: first.branch })).toEqual({ ok: true });
    const head = await checkedGit(repo, ['rev-parse', 'HEAD']);
    expect(await mergeBranch({ repoPath: repo, baseBranch: 'main', branch: second.branch }))
      .toEqual({ ok: false, reason: 'conflict', files: ['README.md'] });
    expect(await checkedGit(repo, ['status', '--porcelain'])).toBe('');
    expect(await checkedGit(repo, ['rev-parse', 'HEAD'])).toBe(head);
    expect((await git(repo, ['rev-parse', '--verify', 'MERGE_HEAD'])).code).not.toBe(0);
    expect(await readFile(path.join(second.path, 'README.md'), 'utf8')).toBe('Second task\n');
  });

  test('parallel createWorktree on same repo', async () => {
    const result = await Promise.all(Array.from({ length: 5 }, (_, i) => create(`t-000${i}`)));
    for (const wt of result) {
      expect(await currentBranch(wt.path)).toBe(wt.branch);
    }
    expect((await checkedGit(repo, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm)).toHaveLength(6);
  });

  test('removeWorktree deletes the directory and branch, including uncommitted files', async () => {
    const wt = await create();
    await writeFile(path.join(wt.path, 'untracked.txt'), 'discard\n');
    await removeWorktree({ repoPath: repo, ...wt, deleteBranch: true });
    created.splice(created.indexOf(wt), 1);
    await expect(access(wt.path)).rejects.toThrow();
    expect((await git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${wt.branch}`])).code).toBe(1);
    expect(await checkedGit(repo, ['worktree', 'list', '--porcelain'])).not.toContain(wt.branch);
  });

  test('removeWorktree can keep the branch', async () => {
    const wt = await create();
    await removeWorktree({ repoPath: repo, ...wt, deleteBranch: false });
    created.splice(created.indexOf(wt), 1);
    await expect(access(wt.path)).rejects.toThrow();
    expect(await checkedGit(repo, ['show-ref', '--verify', `refs/heads/${wt.branch}`])).toContain(wt.branch);
  });

  test('createWorktree throws the git error when the base branch does not exist', async () => {
    const result = await git(repo, ['rev-parse', '--verify', 'missing-base']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).not.toBe('');
    await expect(createWorktree({
      repoPath: repo, baseBranch: 'missing-base', branch: 'fleet/test/t-0001', path: path.join(worktrees, 'bad'),
    })).rejects.toThrow(/missing-base/);
  });
});

test('withRepoLock normalizes paths, serializes operations, and releases after rejection', async () => {
  const order: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const first = withRepoLock(repo, async () => {
    order.push('first');
    await gate;
    throw new Error('expected failure');
  });
  const rejected = expect(first).rejects.toThrow('expected failure');
  const second = withRepoLock(path.join(repo, '.'), async () => { order.push('second'); });
  const other = withRepoLock(worktrees, async () => { order.push('other repo'); });
  await other;
  expect(order).toEqual(['first', 'other repo']);
  release();
  await rejected;
  await second;
  expect(order).toEqual(['first', 'other repo', 'second']);
});
