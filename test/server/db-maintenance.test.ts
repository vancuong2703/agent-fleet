import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { backupDatabase, checkDatabase, ensureRecentBackup, repairDatabase } from '../../server/db-maintenance.js';
import { corruptRunsIndex, seedDatabase } from './db-corruption-helper.js';

let dir: string;
let dbPath: string;
let backupDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fleet-dbm-'));
  dbPath = path.join(dir, 'fleet.db');
  backupDir = path.join(dir, 'backups');
});
afterEach(() => { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe('checkDatabase', () => {
  test('accepts a healthy database', () => {
    seedDatabase(dbPath);
    expect(checkDatabase(dbPath)).toEqual({ ok: true, errors: [] });
  });
  test('detects an index that disagrees with its table (quick_check would miss this)', () => {
    seedDatabase(dbPath);
    corruptRunsIndex(dbPath);
    const result = checkDatabase(dbPath);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('idx_runs_taskId');
  });
  test('reports a malformed page as an error instead of throwing', () => {
    seedDatabase(dbPath);
    corruptRunsIndex(dbPath, 'garbage');
    const result = checkDatabase(dbPath);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/malformed/i);
  });
});

describe('backupDatabase', () => {
  test('writes a consistent copy and keeps only the newest five', () => {
    const { runs } = seedDatabase(dbPath);
    const made: string[] = [];
    for (let i = 0; i < 7; i++) made.push(backupDatabase(dbPath, backupDir));
    const kept = readdirSync(backupDir).filter(name => /^fleet-.*\.db$/.test(name));
    expect(kept).toHaveLength(5);
    expect(existsSync(made[6]!)).toBe(true);
    expect(existsSync(made[0]!)).toBe(false);
    const copy = new DatabaseSync(made[6]!);
    expect(Number((copy.prepare('SELECT count(*) AS c FROM runs').get() as { c: number }).c)).toBe(runs);
    copy.close();
  });
});

describe('ensureRecentBackup', () => {
  test('backs up when none exists, skips when the newest is under 24 h old, backs up again when older', () => {
    seedDatabase(dbPath);
    const first = ensureRecentBackup(dbPath, backupDir);
    expect(first.backupPath).toBeTruthy();
    expect(ensureRecentBackup(dbPath, backupDir).backupPath).toBeUndefined();
    const old = new Date(Date.now() - 25 * 3_600_000);
    utimesSync(first.backupPath!, old, old);
    expect(ensureRecentBackup(dbPath, backupDir).backupPath).toBeTruthy();
  });
  test('a backup failure is returned as a warning and never throws', () => {
    seedDatabase(dbPath);
    writeFileSync(backupDir, 'a file where the directory should be');
    const result = ensureRecentBackup(dbPath, backupDir);
    expect(result.backupPath).toBeUndefined();
    expect(result.warning).toBeTruthy();
  });
});

describe('repairDatabase', () => {
  test('is a no-op report on a healthy database (no backup left behind, bytes untouched)', () => {
    const { runs } = seedDatabase(dbPath);
    const before = readFileSync(dbPath);
    const result = repairDatabase(dbPath, backupDir);
    expect(result).toMatchObject({ ok: true, errors: [], backupPath: '' });
    expect(result.rowCounts.runs).toBe(runs);
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    expect(existsSync(backupDir) ? readdirSync(backupDir) : []).toEqual([]);
  });

  test('rebuilds a broken index, keeps every row and leaves a backup of the broken file', () => {
    const { runs, taskId } = seedDatabase(dbPath);
    corruptRunsIndex(dbPath);
    const broken = readFileSync(dbPath);
    const result = repairDatabase(dbPath, backupDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.rowCounts).toMatchObject({ plans: 1, tasks: 1, runs });
    expect(readFileSync(result.backupPath).equals(broken)).toBe(true);
    expect(checkDatabase(dbPath).ok).toBe(true);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT * FROM runs WHERE taskId = ?').all(taskId)).toHaveLength(runs);
    db.close();
  });

  test('garbage index pages: recovers every row and the formerly failing query works', () => {
    const { runs, taskId } = seedDatabase(dbPath);
    corruptRunsIndex(dbPath, 'garbage');
    const broken = readFileSync(dbPath);
    const result = repairDatabase(dbPath, backupDir);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(['recreate-indexes', 'rebuild']).toContain(result.strategy);
    expect(result.rowCounts).toMatchObject({ plans: 1, tasks: 1, runs });
    expect(readFileSync(result.backupPath).equals(broken)).toBe(true);
    expect(checkDatabase(dbPath).ok).toBe(true);
    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT * FROM runs WHERE taskId = ?').all(taskId)).toHaveLength(runs);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name").all()).toHaveLength(4);
    db.close();
  });

  test('the rebuild strategy alone also works (indexes unusable, schema recreated, rows copied)', () => {
    const { runs, taskId } = seedDatabase(dbPath);
    corruptRunsIndex(dbPath, 'garbage');
    const result = repairDatabase(dbPath, backupDir, { only: 'rebuild' });
    expect(result).toMatchObject({ ok: true, strategy: 'rebuild' });
    const db = new DatabaseSync(dbPath);
    expect(db.prepare('SELECT * FROM runs WHERE taskId = ?').all(taskId)).toHaveLength(runs);
    expect(db.prepare('PRAGMA user_version').get()).toBeDefined();
    db.close();
  });

  test('restores the original files and names the backup when nothing can repair it', () => {
    seedDatabase(dbPath);
    writeFileSync(dbPath, Buffer.from('this is not a sqlite database '.repeat(200)));
    const before = readFileSync(dbPath);
    const result = repairDatabase(dbPath, backupDir);
    expect(result.ok).toBe(false);
    expect(result.strategy).toBe('none');
    expect(result.errors.join('\n')).toContain(result.backupPath);
    expect(readFileSync(dbPath).equals(before)).toBe(true);
    expect(readFileSync(result.backupPath).equals(before)).toBe(true);
  });

  test('reports a missing database without creating one', () => {
    const result = repairDatabase(dbPath, backupDir);
    expect(result.ok).toBe(false);
    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(backupDir)).toBe(false);
    void mkdirSync;
  });
});

describe('locked database is not corruption', () => {
  test('a busy file is inconclusive and repair leaves it alone', () => {
    const holder = new DatabaseSync(dbPath);
    try {
      holder.exec('CREATE TABLE t(id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1); BEGIN EXCLUSIVE');
      const check = checkDatabase(dbPath);
      expect(check.ok).toBe(false);
      expect(check.inconclusive).toBe(true);
      const repair = repairDatabase(dbPath, backupDir);
      expect(repair.ok).toBe(false);
      expect(repair.strategy).toBe('none');
      expect(repair.backupPath).toBe('');
    } finally {
      holder.exec('ROLLBACK');
      holder.close();
    }
  });
});
