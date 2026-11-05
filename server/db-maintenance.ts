import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const BACKUP_NAME = /^fleet-\d{8}-\d{9}\.db$/;
const KEEP_BACKUPS = 5;
const BACKUP_MAX_AGE_MS = 24 * 3_600_000;
const MAX_REPORTED_ERRORS = 20;

/** `inconclusive`: the check could not run (locked, no permission), which says nothing about damage. */
export interface CheckResult { ok: boolean; errors: string[]; inconclusive?: boolean }
export type RepairStrategy = 'none' | 'reindex' | 'recreate-indexes' | 'rebuild';
export interface RepairResult {
  ok: boolean; backupPath: string; errors: string[]; rowCounts: Record<string, number>;
  /** Which strategy fixed it; 'none' when nothing was needed or nothing worked. */
  strategy: RepairStrategy;
}

/** True for the errors SQLite raises when the file's structure is damaged. */
export function isCorruptionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { message?: unknown; code?: unknown; errcode?: unknown };
  return e.errcode === 11 || e.errcode === 26
    || e.code === 'SQLITE_CORRUPT' || e.code === 'SQLITE_NOTADB'
    || /malformed|SQLITE_CORRUPT|file is not a database/i.test(String(e.message ?? ''));
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/**
 * Full `PRAGMA integrity_check` (not quick_check: that skips index/table consistency).
 * Never throws; an unreadable file is reported as an error.
 */
export function checkDatabase(dbPath: string): CheckResult {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(dbPath);
    const rows = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
    const errors = rows.map(row => String(row.integrity_check)).filter(line => line !== 'ok');
    return { ok: errors.length === 0, errors: errors.slice(0, MAX_REPORTED_ERRORS) };
  } catch (error) {
    return { ok: false, errors: [message(error)], ...(isCorruptionError(error) ? {} : { inconclusive: true }) };
  } finally {
    try { db?.close(); } catch { /* nothing more to release */ }
  }
}

function stamp(date = new Date()): string {
  const p = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}${p(date.getMilliseconds(), 3)}`;
}

function listBackups(backupDir: string): string[] {
  if (!existsSync(backupDir)) return [];
  return readdirSync(backupDir).filter(name => BACKUP_NAME.test(name)).sort();
}

/** Consistent snapshot via VACUUM INTO; keeps the newest five `fleet-*.db`. Throws on failure. */
export function backupDatabase(dbPath: string, backupDir: string): string {
  mkdirSync(backupDir, { recursive: true });
  let target = path.join(backupDir, `fleet-${stamp()}.db`);
  for (let n = 1; existsSync(target); n++) target = path.join(backupDir, `fleet-${stamp(new Date(Date.now() + n))}.db`);
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('VACUUM INTO ?').run(target);
  } catch (error) {
    rmSync(target, { force: true });
    throw error;
  } finally {
    db.close();
  }
  for (const old of listBackups(backupDir).slice(0, -KEEP_BACKUPS)) rmSync(path.join(backupDir, old), { force: true });
  return target;
}

/**
 * Back up when the newest backup is older than 24 h (or none exists). A failure becomes a
 * warning: a missing backup must never block startup.
 */
export function ensureRecentBackup(dbPath: string, backupDir: string, now = Date.now()): { backupPath?: string; warning?: string } {
  try {
    const newest = listBackups(backupDir).at(-1);
    if (newest && now - statSync(path.join(backupDir, newest)).mtimeMs < BACKUP_MAX_AGE_MS) return {};
    return { backupPath: backupDatabase(dbPath, backupDir) };
  } catch (error) {
    return { warning: `Không tạo được bản sao lưu CSDL: ${message(error)}` };
  }
}

const SIDECARS = ['', '-wal', '-shm'] as const;

function rowCounts(dbPath: string): Record<string, number> {
  const db = new DatabaseSync(dbPath);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>;
    const counts: Record<string, number> = {};
    // NOT INDEXED forces a table scan: a damaged index must not influence the count.
    for (const { name } of tables) counts[name] = Number((db.prepare(`SELECT count(*) AS c FROM ${quote(name)} NOT INDEXED`).get() as { c: number }).c);
    return counts;
  } finally {
    db.close();
  }
}

function copyWithSidecars(from: string, to: string): void {
  for (const suffix of SIDECARS) {
    if (existsSync(from + suffix)) copyFileSync(from + suffix, to + suffix);
    else if (suffix !== '') rmSync(to + suffix, { force: true });
  }
}

/** Drop every explicit index (editing the schema when its pages cannot be walked) and recreate it. */
function recreateIndexes(dbPath: string): void {
  let db = new DatabaseSync(dbPath);
  let indexes: Array<{ name: string; sql: string }>;
  try {
    indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as typeof indexes;
    const unreadable: string[] = [];
    for (const { name } of indexes) {
      try { db.exec(`DROP INDEX ${quote(name)}`); } catch { unreadable.push(name); }
    }
    if (unreadable.length > 0) {
      // The b-tree cannot be walked, so unhook it from the schema; VACUUM below reclaims its pages.
      db.exec('PRAGMA writable_schema = ON');
      for (const name of unreadable) db.prepare("DELETE FROM sqlite_master WHERE type = 'index' AND name = ?").run(name);
      db.exec('PRAGMA writable_schema = OFF');
    }
  } finally { db.close(); }
  db = new DatabaseSync(dbPath);
  try {
    for (const { sql } of indexes) db.exec(sql);
    db.exec('VACUUM');
  } finally { db.close(); }
}

/** Copy schema and rows (index-free table scans) into a fresh file, verify it, then swap it in. */
function rebuildDatabase(dbPath: string): void {
  const temp = `${dbPath}.rebuild`;
  rmSync(temp, { force: true });
  const src = new DatabaseSync(dbPath);
  try {
    const dst = new DatabaseSync(temp);
    try {
      const objects = src.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 WHEN 'view' THEN 2 ELSE 3 END, rowid").all() as Array<{ type: string; name: string; sql: string }>;
      const tables = objects.filter(object => object.type === 'table');
      for (const table of tables) dst.exec(table.sql);
      dst.exec('BEGIN');
      for (const { name } of tables) {
        const columns = (src.prepare(`PRAGMA table_info(${quote(name)})`).all() as Array<{ name: string }>).map(column => quote(column.name));
        const insert = dst.prepare(`INSERT INTO ${quote(name)} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
        for (const row of src.prepare(`SELECT ${columns.join(', ')} FROM ${quote(name)} NOT INDEXED`).iterate()) {
          insert.run(...(Object.values(row) as Array<null | number | bigint | string | Uint8Array>));
        }
      }
      dst.exec('COMMIT');
      for (const object of objects.filter(candidate => candidate.type !== 'table')) dst.exec(object.sql);
      dst.exec(`PRAGMA user_version = ${Number((src.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)}`);
    } finally { dst.close(); }
  } finally { src.close(); }
  const verdict = checkDatabase(temp);
  if (!verdict.ok) { rmSync(temp, { force: true }); throw new Error(`Bản dựng lại không qua kiểm tra: ${verdict.errors[0]}`); }
  rmSync(`${dbPath}-wal`, { force: true });
  rmSync(`${dbPath}-shm`, { force: true });
  copyFileSync(temp, dbPath);
  rmSync(temp, { force: true });
}

/**
 * Offline repair: copy db/-wal/-shm to backupDir, then try REINDEX, recreating the indexes, and
 * finally a table-by-table rebuild into a new file. A strategy only counts when the integrity check
 * passes and no table lost rows; otherwise the copied files are restored before the next one. A
 * healthy database is only reported on (no backup kept).
 */
export function repairDatabase(dbPath: string, backupDir: string, options: { only?: Exclude<RepairStrategy, 'none'> } = {}): RepairResult {
  if (!existsSync(dbPath)) return { ok: false, backupPath: '', errors: [`Không tìm thấy CSDL: ${dbPath}`], rowCounts: {}, strategy: 'none' };
  mkdirSync(backupDir, { recursive: true });
  let backupPath = path.join(backupDir, `repair-${stamp()}.db`);
  for (let n = 1; existsSync(backupPath); n++) backupPath = path.join(backupDir, `repair-${stamp(new Date(Date.now() + n))}.db`);
  copyWithSidecars(dbPath, backupPath);
  const discardBackup = (): void => { for (const s of SIDECARS) rmSync(backupPath + s, { force: true }); };
  for (const suffix of SIDECARS) {
    if (existsSync(dbPath + suffix) && statSync(dbPath + suffix).size !== statSync(backupPath + suffix).size) {
      discardBackup();
      return { ok: false, backupPath: '', errors: ['Bản sao lưu không khớp kích thước; đã dừng, CSDL không bị thay đổi.'], rowCounts: {}, strategy: 'none' };
    }
  }
  const restore = (): void => {
    rmSync(`${dbPath}.rebuild`, { force: true });
    for (const suffix of SIDECARS) {
      if (existsSync(backupPath + suffix)) copyFileSync(backupPath + suffix, dbPath + suffix);
      else rmSync(dbPath + suffix, { force: true });
    }
  };

  let before: Record<string, number> = {};
  try {
    const initial = checkDatabase(dbPath);
    if (initial.inconclusive) {
      discardBackup();
      return { ok: false, backupPath: '', errors: [`Không đọc được CSDL nên chưa sửa gì: ${initial.errors[0]}`], rowCounts: {}, strategy: 'none' };
    }
    try { before = rowCounts(dbPath); } catch { /* the strategies below report what they can */ }
    if (initial.ok) {
      discardBackup();
      return { ok: true, backupPath: '', errors: [], rowCounts: before, strategy: 'none' };
    }
  } catch (error) {
    restore();
    return { ok: false, backupPath, errors: [message(error)], rowCounts: before, strategy: 'none' };
  }

  const strategies: Array<Exclude<RepairStrategy, 'none'>> = options.only ? [options.only] : ['reindex', 'recreate-indexes', 'rebuild'];
  const failures: string[] = [];
  for (const strategy of strategies) {
    try {
      if (strategy === 'reindex') {
        const db = new DatabaseSync(dbPath);
        try { db.exec('REINDEX'); } finally { db.close(); }
      } else if (strategy === 'recreate-indexes') recreateIndexes(dbPath);
      else rebuildDatabase(dbPath);
      const after = checkDatabase(dbPath);
      const problems = [...after.errors];
      const counts = after.ok ? rowCounts(dbPath) : {};
      for (const [table, count] of Object.entries(before)) {
        if (after.ok && (counts[table] ?? 0) < count) problems.push(`Bảng ${table} mất dòng: ${count} -> ${counts[table] ?? 0}`);
      }
      if (problems.length === 0) return { ok: true, backupPath, errors: [], rowCounts: counts, strategy };
      failures.push(`${strategy}: ${problems[0]}`);
    } catch (error) {
      failures.push(`${strategy}: ${message(error)}`);
    }
    restore();
  }
  failures.push(`Đã khôi phục tệp gốc. Bản sao lưu để khôi phục thủ công: ${backupPath}`);
  return { ok: false, backupPath, errors: failures.slice(-MAX_REPORTED_ERRORS), rowCounts: before, strategy: 'none' };
}
