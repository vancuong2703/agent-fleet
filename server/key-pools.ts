import { existsSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { KeyPool } from '../shared/dashboard.js';

/**
 * Local harbor-key pool support for the OpenCode dashboard card.
 *
 * Only the pool metadata from `key-pool.json` is read: name, port, host and the
 * limits. The `keys` array holds raw credentials and is deliberately never
 * touched — no key value and no environment variable can reach a check, log or
 * the HTTP API through this module.
 */

/** The metadata slice of one `key-pool.json` entry (never the key values). */
export interface KeyPoolDefinition {
  name: string;
  port: number;
  /** Configured host; every request still goes to 127.0.0.1. */
  host: string;
  outputLimit: number;
  requestLimit: number;
  windowDays: number;
}

export const POOL_STATS_TIMEOUT_MS = 1_500;
export const POOL_DOWN_REASON = 'pool không chạy';
export const POOL_INVALID_REASON = 'dữ liệu pool không hợp lệ';
export const POOL_HOST_REASON = 'chỉ hỗ trợ host loopback';

/** Requests only ever target the IPv4 loopback literal. */
const LOOPBACK_HOST = '127.0.0.1';
const MAX_STATS_BYTES = 256 * 1024;

export type StatsRequest = (
  options: http.RequestOptions,
  callback: (response: http.IncomingMessage) => void,
) => http.ClientRequest;

export interface KeyPoolProbeOptions {
  timeoutMs?: number;
  /** Injected transport; tests use it to prove no request leaves loopback. */
  request?: StatsRequest;
}

interface PoolStatsRow {
  name: string;
  outputInWindow: number | null;
  requests: number | null;
  status: string;
  percent: number | null;
  outputLimit: number | null;
  requestLimit: number | null;
  resetAt: string | null;
}

class PoolDataError extends Error {}

/** Loopback covers localhost, ::1 and the 127.0.0.0/8 range. */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (value === 'localhost' || value === '::1') return true;
  const octets = value.split('.');
  if (octets.length !== 4 || octets[0] !== '127') return false;
  return octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/**
 * Read `key-pool.json` and keep only name/port/host/limits per pool. Missing or
 * corrupt files yield an empty list rather than an error: the dashboard treats
 * "no pool configuration" as "no pool data".
 */
export function readKeyPoolDefinitions(filePath: string): KeyPoolDefinition[] {
  if (!filePath || !existsSync(filePath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
  const pools = (raw as { pools?: unknown } | null)?.pools;
  if (!Array.isArray(pools)) return [];

  const definitions: KeyPoolDefinition[] = [];
  for (const entry of pools) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const pool = entry as Record<string, unknown>;
    const name = typeof pool.name === 'string' ? pool.name.trim() : '';
    const port = numberOrNull(pool.port);
    if (!name || port === null || !Number.isInteger(port) || port < 1 || port > 65_535) continue;
    const host = typeof pool.host === 'string' && pool.host.trim().length > 0 ? pool.host.trim() : LOOPBACK_HOST;
    definitions.push({
      name: name.slice(0, 80),
      port,
      host,
      outputLimit: nonNegative(pool.outputLimit),
      requestLimit: nonNegative(pool.requestLimit),
      windowDays: positive(pool.windowDays, 7),
    });
  }
  return definitions;
}

/** `TOKENHARBOR_API_KEY_2` → `...EY_2`; only a name suffix, never a key value. */
export function maskKeyName(name: string): string {
  const value = name.trim();
  if (!value) return '...';
  return `...${value.slice(-4)}`;
}

/** Human label for the configured limits, e.g. `Hạn 385K output / key / 7 ngày`. */
export function limitLabelFor(definition: KeyPoolDefinition): string {
  const parts: string[] = [];
  if (definition.outputLimit > 0) {
    parts.push(`Hạn ${compactNumber(definition.outputLimit)} output / key / ${windowLabel(definition.windowDays)}`);
  }
  if (definition.requestLimit > 0) {
    parts.push(`${compactNumber(definition.requestLimit)} request / ${windowLabel(definition.windowDays)} / key`);
  }
  return parts.join(' · ');
}

/**
 * Read one pool's `/stats` endpoint and map it to the dashboard contract.
 * A stopped pool or an unreadable payload becomes `remainingPct: null` with the
 * reason appended to `limitLabel`; it never throws, so a dead pool cannot fail
 * the whole tool check.
 */
export async function probeKeyPool(
  definition: KeyPoolDefinition,
  options: KeyPoolProbeOptions = {},
): Promise<KeyPool> {
  if (!isLoopbackHost(definition.host)) return unavailablePool(definition, POOL_HOST_REASON);

  let rows: PoolStatsRow[];
  try {
    const payload = await requestStats(
      definition.port,
      options.timeoutMs ?? POOL_STATS_TIMEOUT_MS,
      options.request ?? http.request,
    );
    rows = parseStats(payload);
  } catch (error) {
    return unavailablePool(definition, error instanceof PoolDataError ? POOL_INVALID_REASON : POOL_DOWN_REASON);
  }
  return poolFromStats(definition, rows);
}

function unavailablePool(definition: KeyPoolDefinition, reason: string): KeyPool {
  const limits = limitLabelFor(definition);
  return {
    name: definition.name,
    total: 0,
    ok: 0,
    exhausted: 0,
    remainingPct: null,
    limitLabel: limits ? `${limits} · ${reason}` : reason,
    resetAt: null,
    keys: [],
  };
}

function poolFromStats(definition: KeyPoolDefinition, rows: PoolStatsRow[]): KeyPool {
  const keys = rows.map((row) => {
    const remainingPct = remainingPctFor(row);
    const out = isExhausted(row) || (remainingPct !== null && remainingPct <= 0);
    return {
      label: maskKeyName(row.name),
      status: (out ? 'out' : remainingPct !== null && remainingPct < 50 ? 'low' : 'ok') as KeyPool['keys'][number]['status'],
      pct: out ? 0 : remainingPct,
    };
  });
  const exhausted = keys.filter((key) => key.status === 'out').length;
  const known = keys.map((key) => key.pct).filter((pct): pct is number => pct !== null && Number.isFinite(pct));
  return {
    name: definition.name,
    total: keys.length,
    ok: keys.length - exhausted,
    exhausted,
    remainingPct: known.length ? round1(known.reduce((sum, pct) => sum + pct, 0) / known.length) : null,
    limitLabel: limitLabelFor(definition),
    resetAt: resetAtFor(rows),
    keys,
  };
}

/** Used capacity comes from the counter that matches the configured limit. */
function usedFraction(row: PoolStatsRow): number | null {
  const requestLimit = row.requestLimit ?? 0;
  const outputLimit = row.outputLimit ?? 0;
  let used: number | null = null;
  if (requestLimit > 0 && row.requests !== null) used = row.requests / requestLimit;
  else if (outputLimit > 0 && row.outputInWindow !== null) used = row.outputInWindow / outputLimit;
  else if (row.percent !== null) used = row.percent > 1 ? row.percent / 100 : row.percent;
  if (used === null || !Number.isFinite(used)) return null;
  return Math.min(1, Math.max(0, used));
}

function remainingPctFor(row: PoolStatsRow): number | null {
  if (isExhausted(row)) return 0;
  const used = usedFraction(row);
  return used === null ? null : round1(Math.min(100, Math.max(0, (1 - used) * 100)));
}

function isExhausted(row: PoolStatsRow): boolean {
  if (/^exhaust/i.test(row.status.trim())) return true;
  const used = usedFraction(row);
  return used !== null && used >= 1;
}

/** Earliest exhausted reset (next key back), else the latest window reset. */
function resetAtFor(rows: PoolStatsRow[]): string | null {
  const resets = rows.map((row) => row.resetAt).filter((value): value is string => value !== null);
  if (resets.length === 0) return null;
  const exhaustedResets = rows.filter(isExhausted).map((row) => row.resetAt)
    .filter((value): value is string => value !== null);
  const candidates = (exhaustedResets.length > 0 ? exhaustedResets : resets)
    .slice()
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return exhaustedResets.length > 0 ? candidates[0]! : candidates.at(-1)!;
}

async function requestStats(port: number, timeoutMs: number, request: StatsRequest): Promise<unknown> {
  return await new Promise<unknown>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const clearTimer = (): void => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimer();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const done = (value: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimer();
      resolve(value);
    };

    let clientRequest: http.ClientRequest;
    try {
      clientRequest = request({
        hostname: LOOPBACK_HOST,
        port,
        path: '/stats',
        method: 'GET',
        timeout: timeoutMs,
        headers: { accept: 'application/json' },
      }, (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          fail(new Error(POOL_DOWN_REASON));
          return;
        }
        let body = '';
        let bytes = 0;
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          bytes += Buffer.byteLength(chunk, 'utf8');
          if (bytes > MAX_STATS_BYTES) {
            response.destroy();
            fail(new PoolDataError(POOL_INVALID_REASON));
            return;
          }
          body += chunk;
        });
        response.on('end', () => {
          try {
            done(JSON.parse(body));
          } catch {
            fail(new PoolDataError(POOL_INVALID_REASON));
          }
        });
        response.on('error', () => fail(new Error(POOL_DOWN_REASON)));
      });
    } catch (error) {
      fail(error);
      return;
    }

    clientRequest.on('timeout', () => clientRequest.destroy(new Error(POOL_DOWN_REASON)));
    clientRequest.on('error', (error) => fail(error));
    // Hard deadline: a server that trickles bytes still cannot exceed the budget.
    if (!settled) {
      timer = setTimeout(() => clientRequest.destroy(new Error(POOL_DOWN_REASON)), timeoutMs);
      timer.unref?.();
    }
    clientRequest.end();
  });
}

function parseStats(payload: unknown): PoolStatsRow[] {
  if (!Array.isArray(payload)) throw new PoolDataError(POOL_INVALID_REASON);
  const rows: PoolStatsRow[] = [];
  for (const entry of payload) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!name) continue;
    rows.push({
      name,
      outputInWindow: numberOrNull(row.outputInWindow),
      requests: numberOrNull(row.requests),
      status: typeof row.status === 'string' ? row.status : '',
      percent: numberOrNull(row.percent),
      outputLimit: numberOrNull(row.outputLimit),
      requestLimit: numberOrNull(row.requestLimit),
      resetAt: isoStringOrNull(row.resetAt),
    });
  }
  return rows;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegative(value: unknown): number {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed >= 0 ? parsed : 0;
}

function positive(value: unknown, fallback: number): number {
  const parsed = numberOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : fallback;
}

function isoStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${round1(value / 1_000_000)}M`;
  if (value >= 1_000) return `${round1(value / 1_000)}K`;
  return String(value);
}

function windowLabel(days: number): string {
  return days <= 1 ? 'ngày' : `${days} ngày`;
}
