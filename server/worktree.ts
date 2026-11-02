import path from 'node:path';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { DiffFile, MergeResult } from '../shared/types.js';
import { git, withRepoLock } from './git.js';

export type { MergeResult } from '../shared/types.js';

async function checkedGit(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await git(cwd, args, env);
  if (result.code !== 0) throw new Error(result.stderr || `git ${args[0]} failed (${result.code})`);
  return result.stdout;
}

async function withTemporaryIndex<T>(wt: string, fn: (env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-index-'));
  const index = path.join(dir, 'index');
  try {
    const current = (await checkedGit(wt, ['rev-parse', '--git-path', 'index'])).trim();
    try { await copyFile(path.win32.resolve(wt, current), index); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return await fn({ GIT_INDEX_FILE: index });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withWorktreeLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  // Linked worktrees have different cwd values but share the original repo's .git.
  const commonDir = await checkedGit(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  return withRepoLock(path.win32.dirname(commonDir.trim()), fn);
}

export async function currentBranch(repo: string): Promise<string> {
  return (await checkedGit(repo, ['branch', '--show-current'])).trim();
}

export async function createWorktree(o: { repoPath: string; baseBranch: string; branch: string; path: string }): Promise<void> {
  await withWorktreeLock(o.repoPath, async () => {
    await checkedGit(o.repoPath, ['worktree', 'add', '-b', o.branch, path.win32.resolve(o.path), o.baseBranch]);
  });
}

export async function diffWorktree(wt: string, baseBranch: string): Promise<{ files: DiffFile[]; patch: string }> {
  return withWorktreeLock(wt, () => withTemporaryIndex(wt, async (env) => {
    await checkedGit(wt, ['add', '-A'], env);
    // Compare against the fork point, so commits merged into the base later do not show up reversed.
    const base = (await checkedGit(wt, ['merge-base', 'HEAD', baseBranch])).trim();
    const numstat = await checkedGit(wt, ['diff', '--cached', '--numstat', '-z', base, '--'], env);
    const records = numstat.split('\0');
    const files: DiffFile[] = [];
    for (let i = 0; i < records.length && records[i] !== ''; i++) {
      const record = records[i];
      const firstTab = record.indexOf('\t');
      const secondTab = record.indexOf('\t', firstTab + 1);
      let filePath = record.slice(secondTab + 1);
      if (filePath === '') {
        // A rename has an empty path followed by NUL-separated old and new paths.
        i += 2;
        filePath = records[i];
      }
      const added = record.slice(0, firstTab);
      const removed = record.slice(firstTab + 1, secondTab);
      files.push({ path: filePath, added: added === '-' ? 0 : Number(added), removed: removed === '-' ? 0 : Number(removed) });
    }
    const patch = await checkedGit(wt, ['diff', '--cached', '--no-ext-diff', base, '--'], env);
    return { files, patch };
  }));
}

export async function commitAll(wt: string, message: string): Promise<boolean> {
  return withWorktreeLock(wt, async () => {
    await checkedGit(wt, ['add', '-A']);
    const diff = await git(wt, ['diff', '--cached', '--quiet']);
    if (diff.code === 0) return false;
    if (diff.code !== 1) throw new Error(diff.stderr);
    await checkedGit(wt, ['commit', '-m', message]);
    return true;
  });
}

export async function mergeBranch(o: { repoPath: string; baseBranch: string; branch: string }): Promise<MergeResult> {
  return withWorktreeLock(o.repoPath, async () => {
    if ((await checkedGit(o.repoPath, ['status', '--porcelain'])).trim() !== '') {
      return { ok: false, reason: 'dirty' };
    }
    if (await currentBranch(o.repoPath) !== o.baseBranch) {
      return { ok: false, reason: 'wrong_branch' };
    }
    const merged = await git(o.repoPath, ['merge', '--no-ff', '--no-edit', o.branch]);
    if (merged.code === 0) return { ok: true };
    const files = (await checkedGit(o.repoPath, ['diff', '--name-only', '--diff-filter=U', '-z'])).split('\0').filter(Boolean);
    if (files.length === 0) return { ok: false, reason: 'error', files: [], message: merged.stderr };
    await checkedGit(o.repoPath, ['merge', '--abort']);
    return { ok: false, reason: 'conflict', files };
  });
}

export async function removeWorktree(o: { repoPath: string; path: string; branch: string; deleteBranch: boolean }): Promise<void> {
  await withWorktreeLock(o.repoPath, async () => {
    try {
      await checkedGit(o.repoPath, ['worktree', 'remove', '--force', path.win32.resolve(o.path)]);
    } catch {
      await git(o.repoPath, ['worktree', 'prune']).catch(() => {});
      await rm(path.win32.resolve(o.path), { recursive: true, force: true }).catch(() => {});
      await git(o.repoPath, ['worktree', 'prune']).catch(() => {});
    }
    if (o.deleteBranch) await checkedGit(o.repoPath, ['branch', '-D', o.branch]);
  });
}
