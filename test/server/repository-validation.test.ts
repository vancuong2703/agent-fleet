import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { git } from '../../server/git.js';
import { makeTempRepo } from '../helpers/repo.js';
import { validateRepository, type RepositoryGitExecutor } from '../../server/repository-validation.js';

describe('read-only repository validation', () => {
  let repo: string;
  let root: string;
  beforeAll(async () => { repo = await makeTempRepo(); root = path.dirname(repo); });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  test('resolves a Git root and a Unicode subdirectory without changing repository state', async () => {
    const nested = path.join(repo, 'thư mục con');
    await mkdir(nested);
    const before = await git(repo, ['status', '--porcelain']);
    expect(await validateRepository(repo)).toMatchObject({ valid: true, repoPath: repo, branch: 'main' });
    expect(await validateRepository(nested)).toMatchObject({ valid: true, repoPath: repo, branch: 'main' });
    expect(await git(repo, ['status', '--porcelain'])).toEqual(before);
  });

  test('accepts a linked worktree and detached HEAD', async () => {
    const linked = path.join(root, 'linked workspace');
    expect((await git(repo, ['worktree', 'add', '--detach', linked, 'HEAD'])).code).toBe(0);
    try {
      expect(await validateRepository(linked)).toMatchObject({ valid: true, repoPath: linked, branch: null });
    } finally {
      expect((await git(repo, ['worktree', 'remove', linked])).code).toBe(0);
    }
  });

  test('rejects non-repository, missing and bare directories', async () => {
    const bare = path.join(root, 'bare.git');
    expect((await git(root, ['init', '--bare', bare])).code).toBe(0);
    for (const candidate of [root, path.join(root, 'missing'), bare]) {
      const result = await validateRepository(candidate);
      expect(result).toMatchObject({ valid: false, repoPath: null, branch: null });
      expect(result.message).toContain('Git');
    }
  });

  test.each(['', '   ', 'relative/path', 'C:relative', '\\root-relative', '/usr/src', 'C:\\repo\nsecret', 'C:\\repo\u0000'])('rejects unsafe or relative input before Git: %j', async candidate => {
    const execute = vi.fn<RepositoryGitExecutor>();
    expect((await validateRepository(candidate, { execute })).valid).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  test('uses fixed argv, bounded hidden shell-free execution and supports quoted UNC paths', async () => {
    const execute = vi.fn<RepositoryGitExecutor>().mockResolvedValueOnce('true\n//server/share/thư mục\n').mockResolvedValueOnce('main\n');
    const result = await validateRepository('"\\\\server\\share\\thư mục"', { execute });
    expect(result).toMatchObject({ valid: true, repoPath: '\\\\server\\share\\thư mục', branch: 'main' });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toBe('git');
    expect(execute.mock.calls[0]?.[1]).toEqual(['-C', '\\\\server\\share\\thư mục', 'rev-parse', '--is-inside-work-tree', '--show-toplevel']);
    expect(execute.mock.calls[0]?.[2]).toMatchObject({ timeout: 3000, shell: false, windowsHide: true });
    expect(execute.mock.calls[1]?.[2].timeout).toBeLessThanOrEqual(3000);
  });

  test('returns a retryable message after timeout and never exposes raw execution errors', async () => {
    const execute = vi.fn<RepositoryGitExecutor>().mockRejectedValue(Object.assign(new Error('private stderr and path'), { killed: true }));
    const result = await validateRepository('C:\\some repo', { execute });
    expect(result).toMatchObject({ valid: false, repoPath: null, branch: null });
    expect(result.message).toContain('thử lại');
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
