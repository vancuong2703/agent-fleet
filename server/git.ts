import { spawn } from 'node:child_process';
import path from 'node:path';

export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: path.win32.resolve(cwd),
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => { resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

const locks = new Map<string, Promise<void>>();

export async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const key = path.win32.resolve(repoPath).toLowerCase().replace(/[\\/]+$/, '');
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, pending);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === pending) locks.delete(key);
  }
}
