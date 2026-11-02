import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export default async function globalTeardown(): Promise<void> {
  const dataDir = process.env.FLEET_E2E_DATA_DIR;
  if (!dataDir) return;
  const dataPath = path.resolve(dataDir);
  const repo = (await readFile(path.join(dataPath, 'repo-path'), 'utf8')).trim();
  const repoRoot = path.dirname(path.resolve(repo));
  // Validate all absolute targets before killing the test server or removing files.
  for (const [target, prefix] of [
    [dataPath, 'agent-fleet-e2e-'], [repoRoot, 'agent-fleet repo-'],
  ] as const) {
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith(prefix)) {
      throw new Error(`Unexpected E2E cleanup path: ${target}`);
    }
  }
  // All fake runs finish before teardown. Stop our server before removing its
  // SQLite files; Playwright owns and cleans up the webServer launcher.
  const pid = Number(await readFile(path.join(dataPath, 'server.pid'), 'utf8'));
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid E2E server PID');
  try {
    process.kill(pid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await rm(dataPath, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  await rm(repoRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
