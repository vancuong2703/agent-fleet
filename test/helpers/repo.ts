import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { git } from '../../server/git.js';

export async function makeTempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-fleet repo-'));
  const repo = path.join(root, 'repo with space');
  await mkdir(repo);
  for (const args of [
    ['init', '-b', 'main'],
    ['config', '--local', 'user.name', 'Fleet Test'],
    ['config', '--local', 'user.email', 'fleet-test@example.invalid'],
    ['config', '--local', 'core.autocrlf', 'false'],
  ]) {
    const result = await git(repo, args);
    if (result.code !== 0) throw new Error(result.stderr);
  }
  await writeFile(path.join(repo, 'README.md'), 'Original line\n', 'utf8');
  for (const args of [['add', '-A'], ['commit', '-m', 'Initial commit']]) {
    const result = await git(repo, args);
    if (result.code !== 0) throw new Error(result.stderr);
  }
  return repo;
}
