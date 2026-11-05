import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { dataDir, files } from '../server/paths.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

/** Explicit app connections never fall back to a different server/profile. */
export function pinnedServer(): string | undefined {
  const value = process.env.FLEET_SERVER_URL;
  if (!value) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('FLEET_SERVER_URL must be an HTTP loopback origin'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('FLEET_SERVER_URL must be an HTTP loopback origin');
  }
  return url.origin;
}

/** The server instance the app told us to talk to; unset for plain CLI use. */
function pinnedInstance(): string | undefined {
  return process.env.FLEET_SERVER_INSTANCE?.trim() || undefined;
}

export interface HealthProbe { ok: boolean; instanceId?: string }

/** Only a JSON body that identifies an Agent Fleet server counts; any other listener is "not ours". */
export async function probeHealth(baseUrl: string, timeoutMs: number): Promise<HealthProbe> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ok: false };
    const body = await response.json() as { ok?: unknown; service?: unknown; instanceId?: unknown };
    if (body.ok !== true || body.service !== 'agent-fleet') return { ok: false };
    return { ok: true, instanceId: typeof body.instanceId === 'string' ? body.instanceId : undefined };
  } catch {
    return { ok: false };
  }
}

export function instanceMismatchMessage(expected: string, actual: string | undefined): string {
  return `Connected to a different Fleet session: expected instance ${expected}, got ${actual ?? 'unknown'}. `
    + 'Recopy the connection block from the Agent Fleet app and run it in this PowerShell window. The token was not sent.';
}

/** Throws when a pinned instance is set and the listener is a different one. */
function assertInstance(probe: HealthProbe): void {
  const expected = pinnedInstance();
  if (expected && probe.instanceId !== expected) throw new Error(instanceMismatchMessage(expected, probe.instanceId));
}

async function healthy(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const probe = await probeHealth(baseUrl, timeoutMs);
  if (!probe.ok) return false;
  assertInstance(probe);
  return true;
}

export function tokenFilePath(): string { return process.env.FLEET_TOKEN_FILE || files.token(); }

/** The URL commands talk to: the pinned app, else the profile's configured port. */
export function configuredServerUrl(): string {
  return pinnedServer() ?? `http://127.0.0.1:${loadConfig().port}`;
}

export interface ConnectionInfo {
  url: string; instanceId: string | null; pinned: boolean; instancePinned: boolean; tokenSource: string;
}

export async function connectionInfo(): Promise<ConnectionInfo> {
  const pinned = pinnedServer();
  const baseUrl = await ensureServer();
  const probe = await probeHealth(baseUrl, 3_000);
  return {
    url: baseUrl, instanceId: probe.instanceId ?? null, pinned: pinned !== undefined,
    instancePinned: pinnedInstance() !== undefined, tokenSource: tokenFilePath(),
  };
}

async function startupErrorSummary(): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(path.win32.join(dataDir(), 'startup-error.json'), 'utf8')) as
      { code?: unknown; message?: unknown; hint?: unknown };
    const parts = [`${String(raw.code ?? 'startup_error')}: ${String(raw.message ?? '')}`.trim()];
    if (raw.hint) parts.push(`Hint: ${String(raw.hint)}`);
    return ` Server reported ${parts.join(' ')}`;
  } catch {
    return '';
  }
}

export async function ensureServer(options: { startTimeoutMs?: number } = {}): Promise<string> {
  const pinned = pinnedServer();
  const baseUrl = pinned ?? `http://127.0.0.1:${loadConfig().port}`;
  if (await healthy(baseUrl, 3_000)) return baseUrl;
  if (pinned) throw new Error(`Pinned Fleet app is unavailable at ${baseUrl}. Copy the current connection from the app; no second server was started.`);

  const compiled = path.win32.resolve(root, 'server/main.js');
  const child = spawn(process.execPath, existsSync(compiled) ? [compiled] : [
    require.resolve('tsx/cli', { paths: [root] }), path.win32.resolve(root, 'server/main.ts'),
  ], {
    detached: true, windowsHide: true, shell: false, stdio: 'ignore', env: { ...process.env },
  });
  let spawnError: Error | undefined;
  child.once('error', (error) => { spawnError = error; });
  child.unref();

  const timeoutMs = options.startTimeoutMs ?? 10_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    await delay(Math.min(200, deadline - Date.now()));
    const remaining = deadline - Date.now();
    if (remaining > 0 && await healthy(baseUrl, Math.min(500, remaining))) return baseUrl;
  }
  throw new Error(`Fleet server did not become healthy at ${baseUrl} within ${Math.round(timeoutMs / 1000)} seconds.${await startupErrorSummary()}`);
}

export async function stopServer(): Promise<void> {
  const pinned = pinnedServer();
  if (!pinned) {
    const pidFile = path.win32.join(dataDir(), 'server.pid');
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Invalid server PID in ${pidFile}`);
  }
  const baseUrl = pinned ?? `http://127.0.0.1:${loadConfig().port}`;
  // Verifies identity (throws on a different instance) before the token is sent.
  if (!await healthy(baseUrl, 3_000)) throw new Error(`No Fleet server is answering at ${baseUrl}`);
  await apiRequest(baseUrl, '/api/shutdown', {});
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await probeHealth(baseUrl, Math.min(500, deadline - Date.now()))).ok) return;
    await delay(Math.min(200, Math.max(0, deadline - Date.now())));
  }
  throw new Error('Fleet server did not stop within 10 seconds');
}

export class ApiError extends Error {
  constructor(public body: unknown, status: number) {
    super(body && typeof body === 'object' && 'message' in body
      ? String(body.message) : `Fleet API returned HTTP ${status}`);
  }
}

export interface ShadowFs { listDir(dir: string): string[]; exists(file: string): boolean }
const realFs: ShadowFs = {
  listDir: (dir) => { try { return readdirSync(dir); } catch { return []; } },
  exists: (file) => existsSync(file),
};

export interface TokenMismatchInfo {
  shadowFiles: string[]; realTokenPath: string; uncTokenPath: string | null; powershell: string;
}

function psQuote(value: string): string { return `'${value.replaceAll("'", "''")}'`; }

/**
 * A packaged host (MSIX) can virtualize %LOCALAPPDATA% to
 * %LOCALAPPDATA%\Packages\<pfn>\LocalCache\Local, so the CLI reads a different
 * token than the desktop app wrote. Pure: paths only, token contents are never read.
 */
export function detectTokenMismatch(
  env: Record<string, string | undefined>, dataDirectory: string, fs: ShadowFs = realFs,
): TokenMismatchInfo {
  const w = path.win32;
  const localAppData = env.LOCALAPPDATA ? w.normalize(env.LOCALAPPDATA).replace(/[\\/]+$/, '') : undefined;
  const dataPath = w.normalize(dataDirectory);
  const realTokenPath = w.join(dataPath, 'token');
  const shadowFiles: string[] = [];
  const relative = localAppData ? w.relative(localAppData, dataPath) : '';
  if (localAppData && relative && !relative.startsWith('..') && !w.isAbsolute(relative)) {
    const packages = w.join(localAppData, 'Packages');
    for (const pfn of fs.listDir(packages)) {
      const candidate = w.join(packages, pfn, 'LocalCache', 'Local', relative, 'token');
      if (candidate.toLowerCase() !== realTokenPath.toLowerCase() && fs.exists(candidate)) shadowFiles.push(candidate);
    }
  }
  const drive = /^([A-Za-z]):\\(.*)$/.exec(realTokenPath);
  const uncTokenPath = drive ? `\\\\localhost\\${drive[1]!.toUpperCase()}$\\${drive[2]}` : null;
  return { shadowFiles, realTokenPath, uncTokenPath, powershell: `$env:FLEET_TOKEN_FILE = ${psQuote(uncTokenPath ?? realTokenPath)}` };
}

export class TokenMismatchError extends ApiError {
  constructor(body: unknown, public info: TokenMismatchInfo) {
    super(body, 401);
    this.message = [
      'The Fleet token this CLI read does not match this app (HTTP 401).',
      info.shadowFiles.length
        ? `The CLI is probably reading a redirected AppData copy: ${info.shadowFiles.join(', ')}`
        : 'The token file may be stale or belong to another profile.',
      `The app's token file is ${info.realTokenPath}.`,
      'Run this in PowerShell, then retry:',
      info.powershell,
    ].join('\n');
  }
}

/** HTTP has no header timeout here: fleet wait may legitimately take hours. */
export async function apiRequest<T>(baseUrl: string, route: string, body?: unknown): Promise<T> {
  const token = (await readFile(tokenFilePath(), 'utf8')).trim();
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
          if (status === 401) reject(new TokenMismatchError(result, detectTokenMismatch(process.env, dataDir())));
          else if (status < 200 || status >= 300) reject(new ApiError(result, status));
          else resolve(result as T);
        } catch (error) { reject(error); }
      });
    });
    request.once('error', reject);
    request.end(payload);
  });
}
