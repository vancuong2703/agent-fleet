import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeTempRepo } from '../helpers/repo.js';

export default async function globalSetup(): Promise<void> {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('Missing temporary FLEET_DATA_DIR');
  const repoFile = path.join(dataDir, 'repo-path');
  if (existsSync(repoFile)) return;

  // Explicitly disable real agents: smoke tests must not invoke installed CLIs.
  const agents = Object.fromEntries(['codex', 'qodercli', 'agy', 'opencode'].map((id) => [
    id, { bin: null, maxParallel: 2, extraArgs: [] },
  ]));
  await writeFile(path.join(dataDir, 'fleet.config.json'), JSON.stringify({
    port: Number(process.env.FLEET_E2E_PORT ?? 4610),
    agents,
    maxParallelTotal: 4,
    timeouts: { totalMin: 1, idleMin: 1 },
  }), 'utf8');
  await writeFile(repoFile, await makeTempRepo(), 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await globalSetup();
}
