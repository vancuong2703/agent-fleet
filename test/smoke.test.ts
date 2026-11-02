import { expect, test } from 'vitest';

test('built-in SQLite opens an in-memory database and executes SELECT 1', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  try {
    expect(db.prepare('SELECT 1 AS value').get()?.value).toBe(1);
  } finally {
    db.close();
  }
});

test('Windows PTY runs cmd.exe /c echo hi within five seconds', async () => {
  const { spawn } = await import('@lydell/node-pty');
  const terminal = spawn('cmd.exe', ['/c', 'echo', 'hi'], {
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  });
  let output = '';
  let exited = false;
  const data = terminal.onData((chunk) => { output += chunk; });
  let exit: { dispose(): void } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('PTY did not exit within five seconds: ' + output)), 4500);
      exit = terminal.onExit(() => {
        exited = true;
        resolve();
      });
    });
    expect(output).toContain('hi');
  } finally {
    clearTimeout(timer);
    data.dispose();
    exit?.dispose();
    if (!exited) terminal.kill();
  }
}, 5000);
