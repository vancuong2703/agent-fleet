import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Base data directory. Honors FLEET_DATA_DIR on every call (never cached) so
 * tests can point it at a fresh temp dir between cases.
 */
export function dataDir(): string {
  const dir =
    process.env.FLEET_DATA_DIR ??
    path.win32.join(localAppData(), 'agent-fleet');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function localAppData(): string {
  return (
    process.env.LOCALAPPDATA ??
    path.win32.join(process.env.USERPROFILE ?? homedir(), 'AppData', 'Local')
  );
}

export const files = {
  db(): string {
    return path.win32.join(dataDir(), 'fleet.db');
  },
  log(runId: string): string {
    return ensureParent(path.win32.join(dataDir(), 'logs', `${runId}.jsonl`));
  },
  brief(runId: string): string {
    return ensureParent(path.win32.join(dataDir(), 'briefs', `${runId}.md`));
  },
  worktree(repoName: string, taskId: string): string {
    return path.win32.join(dataDir(), 'worktrees', repoName, taskId);
  },
  token(): string {
    return path.win32.join(dataDir(), 'token');
  },
  config(): string {
    return path.win32.join(dataDir(), 'fleet.config.json');
  },
};

function ensureParent(file: string): string {
  mkdirSync(path.win32.dirname(file), { recursive: true });
  return file;
}
