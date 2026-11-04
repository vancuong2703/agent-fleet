import { existsSync } from 'node:fs';
import { copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeTempRepo } from '../helpers/repo.js';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * T8: đặt sẵn `dashboard-checks.json` (đúng định dạng cache `version: 1` của
 * server) vào thư mục dữ liệu **trước khi** server khởi động, để spec dashboard
 * đọc được check đã lưu qua GET thật thay vì mock toàn bộ API. Idempotent vì
 * script này chạy hai lần: một lần trong lệnh webServer, một lần ở globalSetup.
 */
async function seedDashboardChecks(dataDir: string): Promise<void> {
  const target = path.join(dataDir, 'dashboard-checks.json');
  if (existsSync(target)) return;
  const source = path.join(fixtureDir, 'dashboard-checks.json');
  if (!existsSync(source)) throw new Error(`Missing E2E fixture: ${source}`);
  await copyFile(source, target);
}

export default async function globalSetup(): Promise<void> {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('Missing temporary FLEET_DATA_DIR');
  await seedDashboardChecks(dataDir);
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
