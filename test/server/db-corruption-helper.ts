import { closeSync, openSync, writeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../../server/store.js';

/** Build a DB with the real schema and rows, then close it with the WAL checkpointed. */
export function seedDatabase(dbPath: string, runs = 30): { taskId: string; runs: number } {
  const store = new Store(dbPath);
  const plan = store.createPlan({ name: 'p', repoPath: 'C:\\repo', baseBranch: 'main' });
  const task = store.createTask({ planId: plan.id, title: 't', agent: 'fake', branch: 'b', worktreePath: 'C:\\wt', checkCmd: null });
  for (let i = 0; i < runs; i++) {
    store.createRun({ taskId: task.id, agent: 'fake', brief: `brief ${i}`, note: null, commandPolicy: 'ask', allowedCommands: [] });
  }
  store.close();
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  return { taskId: task.id, runs };
}

/**
 * Corrupt idx_runs_taskId by editing its root page on disk (the table data stays intact).
 * 'drop-entries': the leaf parses but forgets every entry, so the index disagrees with the table
 *   (REINDEX can fix this). 'garbage': the page is scrambled, so SQLite reports "malformed".
 * Needs a small seed (index root must be a leaf page).
 */
export function corruptRunsIndex(dbPath: string, mode: 'drop-entries' | 'garbage' = 'drop-entries'): void {
  const db = new DatabaseSync(dbPath);
  const root = Number((db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'idx_runs_taskId'").get() as { rootpage: number }).rootpage);
  const pageSize = Number((db.prepare('PRAGMA page_size').get() as { page_size: number }).page_size);
  db.close();
  const fd = openSync(dbPath, 'r+');
  try {
    const offset = (root - 1) * pageSize;
    if (mode === 'garbage') {
      const page = Buffer.alloc(pageSize, 0xab);
      page[0] = 0x0a;
      writeSync(fd, page, 0, pageSize, offset);
    } else {
      writeSync(fd, Buffer.from([0, 0]), 0, 2, offset + 3);
    }
  } finally {
    closeSync(fd);
  }
}
