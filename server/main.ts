import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer, createPtyResolver } from './api.js';
import { Bus } from './bus.js';
import { loadConfig, readOrCreateToken } from './config.js';
import { dataDir, files } from './paths.js';
import { PtyManager } from './pty.js';
import { TaskService } from './service.js';
import { Store } from './store.js';

const config = loadConfig();
const token = readOrCreateToken();
const store = new Store(files.db());
const bus = new Bus();
const ptyManager = new PtyManager(createPtyResolver(store));
const service = new TaskService({ store, bus, config, onBeforeWorktreeChange: (taskId) => ptyManager.kill(taskId) });
const app = buildServer({ service, store, bus, token, ptyManager, port: config.port, shutdown });
const pidFile = path.win32.join(dataDir(), 'server.pid');
let shuttingDown = false;
let wrotePid = false;

async function close(): Promise<void> {
  ptyManager.killAll();
  try {
    await service.close();
    await app.close();
  } finally {
    store.close();
    if (wrotePid) rmSync(pidFile, { force: true });
  }
}

async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await close();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
process.once('SIGHUP', shutdown);
process.once('SIGBREAK', shutdown);

try {
  await app.listen({ port: config.port, host: '127.0.0.1' });
  service.recover();
  writeFileSync(pidFile, String(process.pid), 'utf8');
  wrotePid = true;
  console.log(`Agent fleet server on http://127.0.0.1:${config.port}`);
} catch (error) {
  console.error(error);
  await close();
  process.exitCode = 1;
}
