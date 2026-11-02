import { spawn, spawnSync } from 'node:child_process';

/** Executable name of a running process (e.g. `codex.exe`), lowercased, or null if it is gone. */
export function processImage(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const result = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 5000,
  });
  const match = /^"([^"]+)","(\d+)"/m.exec(result.stdout ?? '');
  return match && Number(match[2]) === pid ? match[1]!.toLowerCase() : null;
}

export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Wait for taskkill to finish so descendants are gone before returning. */
export function killTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const child = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { output += chunk; });
    child.stderr.on('data', (chunk: string) => { output += chunk; });
    child.once('error', reject);
    child.once('close', (code) => {
      // Testing liveness also handles localized taskkill "not found" messages
      // and a process which exited between the request and taskkill starting.
      if (code === 0 || !isAlive(pid)) resolve();
      else reject(new Error(`taskkill failed (${code}): ${output.trim()}`));
    });
  });
}
