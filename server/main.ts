import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildServer, createPtyResolver } from './api.js';
import { Bus } from './bus.js';
import { loadConfig, readOrCreateToken } from './config.js';
import { checkDatabase, ensureRecentBackup, repairDatabase } from './db-maintenance.js';
import { dataDir, files } from './paths.js';
import { isAlive, processImage } from './process.js';
import { PtyManager } from './pty.js';
import { TaskService } from './service.js';
import { clearStartupReport, redact, writeStartupReport } from './startup-report.js';
import { Store } from './store.js';

/** Last lines this process printed; they go into startup-error.json (redacted there). */
const logTail: string[] = [];
function say(kind: 'log' | 'error' | 'warn', line: string): void {
  logTail.push(line);
  if (logTail.length > 20) logTail.shift();
  console[kind](line);
}

function describe(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

function runRepair(): void {
  let result: ReturnType<typeof repairDatabase>;
  try {
    const pidFile = path.win32.join(dataDir(), 'server.pid');
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8').trim()) : 0;
    if (pid > 0 && pid !== process.pid && isAlive(pid) && (processImage(pid) ?? '').startsWith('node')) {
      result = {
        ok: false, backupPath: '', rowCounts: {}, strategy: 'none',
        errors: [`Máy chủ (pid ${pid}) đang chạy (tiến trình node còn sống). Hãy tắt nó trước khi sửa; nếu chắc chắn đã tắt, xoá tệp server.pid.`],
      };
    } else {
      result = repairDatabase(files.db(), path.win32.join(dataDir(), 'backups'));
    }
  } catch (error) {
    result = { ok: false, backupPath: '', rowCounts: {}, strategy: 'none', errors: [describe(error)] };
  }
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}

async function startServer(): Promise<void> {
  let store: Store | undefined;
  let service: TaskService | undefined;
  let app: ReturnType<typeof buildServer> | undefined;
  let ptyManager: PtyManager | undefined;
  let pidFile = '';
  let shuttingDown = false;
  let wrotePid = false;

  async function close(): Promise<void> {
    ptyManager?.killAll();
    try {
      await service?.close();
      await app?.close();
    } finally {
      store?.close();
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

  /** Report a fatal error without a raw stack on screen, then release everything. */
  async function fail(error: unknown): Promise<void> {
    const stack = error instanceof Error && error.stack ? error.stack.split('\n').slice(0, 8) : [];
    const report = writeStartupReport(error, [...logTail, ...stack]);
    say('error', `Agent Fleet không khởi động/chạy tiếp được${report ? ` [${report.code}]` : ''}: ${describe(error)}`);
    if (report) say('error', report.hint);
    try { await close(); } catch (closeError) { console.error(`Dọn dẹp lỗi: ${describe(closeError)}`); }
  }

  let crashing = false;
  const crash = (error: unknown): void => {
    if (crashing) return;
    crashing = true;
    setTimeout(() => process.exit(1), 5_000).unref();
    void fail(error).finally(() => process.exit(1));
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);
  process.once('SIGBREAK', shutdown);
  process.once('unhandledRejection', crash);
  process.once('uncaughtException', crash);

  try {
    const config = loadConfig();
    const token = readOrCreateToken();
    const dbPath = files.db();
    if (existsSync(dbPath)) {
      const check = checkDatabase(dbPath);
      if (!check.ok) {
        if (check.inconclusive) throw new Error(`Không đọc được CSDL để kiểm tra: ${check.errors[0]}`);
        throw Object.assign(new Error(`Kiểm tra toàn vẹn CSDL thất bại: ${check.errors.slice(0, 3).join('; ')}`), { code: 'SQLITE_CORRUPT' });
      }
      const backup = ensureRecentBackup(dbPath, path.win32.join(dataDir(), 'backups'));
      if (backup.warning) say('warn', backup.warning);
    }
    store = new Store(dbPath);
    const bus = new Bus();
    ptyManager = new PtyManager(createPtyResolver(store));
    const manager = ptyManager;
    service = new TaskService({ store, bus, config, onBeforeWorktreeChange: (taskId) => manager.kill(taskId) });
    app = buildServer({ service, store, bus, token, ptyManager, port: config.port, shutdown });
    pidFile = path.win32.join(dataDir(), 'server.pid');
    await app.listen({ port: config.port, host: '127.0.0.1' });
    service.recover();
    writeFileSync(pidFile, String(process.pid), 'utf8');
    wrotePid = true;
    clearStartupReport();
    say('log', `Agent fleet server on http://127.0.0.1:${config.port}`);
  } catch (error) {
    await fail(error);
    process.exitCode = 1;
  }
}

if (process.argv.includes('--repair-db')) runRepair();
else await startServer();
