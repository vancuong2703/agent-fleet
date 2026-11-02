import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { files } from '../server/paths.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

async function healthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok && (await response.json() as { ok?: boolean }).ok === true;
  } catch {
    return false;
  }
}

export async function ensureServer(): Promise<string> {
  const baseUrl = `http://127.0.0.1:${loadConfig().port}`;
  if (await healthy(baseUrl, 500)) return baseUrl;

  const child = spawn(process.execPath, [
    require.resolve('tsx/cli', { paths: [root] }),
    path.win32.resolve(root, 'server/main.ts'),
  ], {
    detached: true, windowsHide: true, shell: false, stdio: 'ignore', env: { ...process.env },
  });
  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  child.unref();

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    await delay(Math.min(200, deadline - Date.now()));
    const remaining = deadline - Date.now();
    if (remaining > 0 && await healthy(baseUrl, Math.min(500, remaining))) return baseUrl;
  }
  throw new Error(`Fleet server did not become healthy at ${baseUrl} within 10 seconds`);
}

export class ApiError extends Error {
  constructor(public body: unknown, status: number) {
    super(body && typeof body === 'object' && 'message' in body
      ? String(body.message) : `Fleet API returned HTTP ${status}`);
  }
}

/** HTTP has no header timeout here: fleet wait may legitimately take hours. */
export async function apiRequest<T>(baseUrl: string, route: string, body?: unknown): Promise<T> {
  const token = (await readFile(files.token(), 'utf8')).trim();
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise<T>((resolve, reject) => {
    const request = http.request(new URL(route, baseUrl), {
      method: payload === undefined ? 'GET' : 'POST',
      headers: {
        'x-fleet-token': token,
        ...(payload === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
      },
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { text += chunk; });
      response.once('error', reject);
      response.once('end', () => {
        try {
          const result: unknown = text.length ? JSON.parse(text) : null;
          const status = response.statusCode ?? 500;
          if (status < 200 || status >= 300) reject(new ApiError(result, status));
          else resolve(result as T);
        } catch (error) { reject(error); }
      });
    });
    request.once('error', reject);
    request.end(payload);
  });
}
