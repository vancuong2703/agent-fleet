import http, { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { DashboardCheck } from '../../shared/dashboard.js';
import type { FleetConfig } from '../../server/config.js';
import type { DashboardEnrichmentContext } from '../../server/dashboard/parsers/common.js';
import { enrichOpencode, parseModels } from '../../server/dashboard/parsers/opencode.js';
import {
  POOL_DOWN_REASON,
  POOL_HOST_REASON,
  POOL_INVALID_REASON,
  isLoopbackHost,
  maskKeyName,
  probeKeyPool,
  readKeyPoolDefinitions,
  type KeyPoolDefinition,
  type StatsRequest,
} from '../../server/key-pools.js';

const fixture = readFileSync(new URL('../fixtures/harbor-stats.json', import.meta.url), 'utf8');

const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  })));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A real HTTP server on 127.0.0.1; records the request URLs it receives. */
async function serve(body: string, seen: string[] = []): Promise<number> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    seen.push(`${request.headers.host ?? ''}${request.url ?? ''}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

/** A server that accepts the connection and never answers (timeout case). */
async function serveSilently(): Promise<number> {
  const server = createServer(() => { /* stays open */ });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

/** A loopback port with nothing listening: requests fail with ECONNREFUSED. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function harbor(port: number, overrides: Partial<KeyPoolDefinition> = {}): KeyPoolDefinition {
  return { name: 'harbor', port, host: '127.0.0.1', outputLimit: 385000, requestLimit: 0, windowDays: 7, ...overrides };
}

function temporary(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fleet-opencode-'));
  directories.push(directory);
  return directory;
}

function fleetConfig(keyPoolConfig: string, extraArgs: string[] = ['--model', 'tokenharbor/deepseek-v4.1-flash-1017']): FleetConfig {
  const base = { bin: 'C:\\fake\\opencode-cli.exe', maxParallel: 2, extraArgs: [] as string[] };
  return {
    port: 4500,
    agents: {
      codex: { ...base }, qodercli: { ...base }, agy: { ...base },
      opencode: { ...base, extraArgs },
    },
    maxParallelTotal: 4,
    timeouts: { totalMin: 1, idleMin: 1 },
    dashboard: { opencode: { keyPoolConfig } },
  };
}

function context(config: FleetConfig, stdout: string, ok = true): DashboardEnrichmentContext {
  return {
    agent: 'opencode',
    bin: 'C:\\fake\\opencode-cli.exe',
    directory: 'C:\\fake',
    config,
    check: {} as DashboardCheck,
    results: [],
    redact: (text: string) => text,
    runCommand: async (args, kind = 'status') => ({
      command: `opencode-cli.exe ${args.join(' ')}`,
      kind,
      ok,
      exitCode: ok ? 0 : 1,
      stdout: ok ? stdout : '',
      stderr: ok ? '' : 'CLI unavailable',
    }),
  };
}

describe('harbor-key pool stats', () => {
  test('maps a running pool and only exposes masked key-name suffixes', async () => {
    const seen: string[] = [];
    const port = await serve(fixture, seen);
    const pool = await probeKeyPool(harbor(port));

    expect(pool).toMatchObject({
      name: 'harbor',
      total: 5,
      ok: 4,
      exhausted: 1,
      limitLabel: 'Hạn 385K output / key / 7 ngày',
      resetAt: '2026-11-08T15:51:17.344Z',
    });
    expect(pool.keys.map((key) => key.status)).toEqual(['ok', 'out', 'ok', 'ok', 'ok']);
    expect(pool.keys[0]).toEqual({ label: '...LPHA', status: 'ok', pct: 88.1 });
    expect(pool.keys[1]).toEqual({ label: '...RAVO', status: 'out', pct: 0 });
    expect(pool.remainingPct).toBeCloseTo(67.2, 5);

    // The request went to the loopback literal and the /stats path.
    expect(seen).toEqual([`127.0.0.1:${port}/stats`]);
    // Only the last four characters of a key *name* survive; the full name never does.
    expect(JSON.stringify(pool)).not.toContain('HARBOR_STATS_KEY_ALPHA');
  });

  test('a stopped pool (ECONNREFUSED) reports null data with a reason instead of throwing', async () => {
    const port = await closedPort();
    const pool = await probeKeyPool(harbor(port), { timeoutMs: 400 });

    expect(pool.remainingPct).toBeNull();
    expect(pool.total).toBe(0);
    expect(pool.keys).toEqual([]);
    expect(pool.limitLabel).toContain('385K');
    expect(pool.limitLabel).toContain(POOL_DOWN_REASON);
  });

  test('an invalid JSON payload reports null data with its own reason', async () => {
    const port = await serve('{"pools":');
    const pool = await probeKeyPool(harbor(port));

    expect(pool.remainingPct).toBeNull();
    expect(pool.keys).toEqual([]);
    expect(pool.limitLabel).toContain(POOL_INVALID_REASON);
  });

  test('a pool that never answers times out as "not running"', async () => {
    const port = await serveSilently();
    const pool = await probeKeyPool(harbor(port), { timeoutMs: 60 });

    expect(pool.remainingPct).toBeNull();
    expect(pool.limitLabel).toContain(POOL_DOWN_REASON);
  });

  test('request-limited pools count requests and flag keys that are running low', async () => {
    const port = await serve(JSON.stringify([
      { name: 'ROUTEWAY_KEY_A1', outputInWindow: 0, requests: 200, failures: 0, status: 'ok', percent: 1, outputLimit: 0, requestLimit: 200, resetAt: '2026-11-04T00:00:00.000Z' },
      { name: 'ROUTEWAY_KEY_B2', outputInWindow: 0, requests: 160, failures: 1, status: 'ok', percent: 0.8, outputLimit: 0, requestLimit: 200, resetAt: '2026-11-04T00:00:00.000Z' },
    ]));
    const pool = await probeKeyPool({
      name: 'routeway', port, host: '127.0.0.1', outputLimit: 0, requestLimit: 200, windowDays: 1,
    });

    expect(pool.limitLabel).toBe('200 request / ngày / key');
    expect(pool.keys.map((key) => key.status)).toEqual(['out', 'low']);
    expect(pool.keys.map((key) => key.pct)).toEqual([0, 20]);
    expect(pool).toMatchObject({ total: 2, ok: 1, exhausted: 1 });
    expect(pool.remainingPct).toBe(10);
  });

  test('refuses a non-loopback host without making any request', async () => {
    const request = vi.fn(() => { throw new Error('must not leave loopback'); }) as unknown as StatsRequest;
    const pool = await probeKeyPool(harbor(20130, { host: '203.0.113.9' }), { request });

    expect(request).not.toHaveBeenCalled();
    expect(pool.remainingPct).toBeNull();
    expect(pool.limitLabel).toContain(POOL_HOST_REASON);
  });
});

describe('key-pool.json reading', () => {
  test('keeps pool metadata and never reads the key values', () => {
    const directory = temporary();
    const file = path.join(directory, 'key-pool.json');
    writeFileSync(file, JSON.stringify({
      pools: [{
        name: 'harbor', port: 20130, host: '127.0.0.1', upstream: 'https://example.invalid',
        outputLimit: 385000, requestLimit: 0, windowDays: 7,
        keys: ['sk-test-DO-NOT-LEAK-1', 'sk-test-DO-NOT-LEAK-2'],
      }],
    }));

    const definitions = readKeyPoolDefinitions(file);
    expect(definitions).toEqual([{
      name: 'harbor', port: 20130, host: '127.0.0.1',
      outputLimit: 385000, requestLimit: 0, windowDays: 7,
    }]);
    expect(definitions[0]).not.toHaveProperty('keys');
    expect(JSON.stringify(definitions)).not.toContain('DO-NOT-LEAK');
  });

  test('a missing or corrupt file yields no pools', () => {
    const directory = temporary();
    expect(readKeyPoolDefinitions(path.join(directory, 'missing.json'))).toEqual([]);
    const corrupt = path.join(directory, 'corrupt.json');
    writeFileSync(corrupt, '{not json');
    expect(readKeyPoolDefinitions(corrupt)).toEqual([]);
    const noPort = path.join(directory, 'no-port.json');
    writeFileSync(noPort, JSON.stringify({ pools: [{ name: 'harbor' }, null, 42] }));
    expect(readKeyPoolDefinitions(noPort)).toEqual([]);
  });

  test('masking and loopback checks follow the contract', () => {
    expect(maskKeyName('TOKENHARBOR_API_KEY_2')).toBe('...EY_2');
    expect(maskKeyName('ab')).toBe('...ab');
    for (const host of ['127.0.0.1', '127.1.2.3', 'localhost', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of ['192.168.1.5', '10.0.0.5', '203.0.113.9', 'pool.example.com', '127.0.0.1.example.com']) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('OpenCode enrichment', () => {
  const models = [
    'tokenharbor/deepseek-v4.1-flash:free',
    'tokenharbor/deepseek-v4.1-flash-1017',
    'harbor-pool/deepseek-v4.1-flash:free',
    '9router/ag/gemini-3.8-flash',
    'opencode/deepseek-v4.1-flash-free',
  ].join('\n');

  function workspace(port: number, host = '127.0.0.1', extraArgs?: string[]) {
    const directory = temporary();
    const keyPoolPath = path.join(directory, 'key-pool.json');
    writeFileSync(keyPoolPath, JSON.stringify({
      pools: [{
        name: 'harbor', port, host, outputLimit: 385000, requestLimit: 0, windowDays: 7,
        keys: ['sk-test-DO-NOT-LEAK-1'],
      }],
    }));
    writeFileSync(path.join(directory, 'opencode.json'), JSON.stringify({
      model: 'harbor-pool/deepseek-v4.1-flash:free',
      provider: {
        tokenharbor: {
          models: {
            'deepseek-v4.1-flash:free': { name: 'DeepSeek V4.1 Flash (free)', limit: { context: 1000000 } },
            'deepseek-v4.1-flash-1017': { name: 'DeepSeek V4.1 Flash 1017', limit: { context: 1000000 } },
          },
        },
        'harbor-pool': {
          models: { 'deepseek-v4.1-flash:free': { limit: { context: 1000000 } } },
        },
        '9router': {
          models: { 'ag/gemini-3.8-flash': { name: 'Gemini 3.8 Flash', limit: { context: 1000000 } } },
        },
      },
    }));
    return { directory, keyPoolPath, config: fleetConfig(keyPoolPath, extraArgs) };
  }

  test('reports BYOK, models with provider/context, current model and live pools', async () => {
    const port = await serve(fixture);
    const { config } = workspace(port);

    const enrichment = await enrichOpencode(context(config, models));

    expect(enrichment.plan).toEqual({ name: 'BYOK', tier: 'byok', renewsAt: null, source: 'opencode.json' });
    expect(enrichment.currentModel).toEqual({
      id: 'tokenharbor/deepseek-v4.1-flash-1017',
      label: 'tokenharbor/deepseek-v4.1-flash-1017',
      effort: null,
    });
    expect(enrichment.models).toHaveLength(4);
    expect(enrichment.models?.find((model) => model.id === 'tokenharbor/deepseek-v4.1-flash-1017')).toEqual({
      id: 'tokenharbor/deepseek-v4.1-flash-1017',
      label: 'DeepSeek V4.1 Flash 1017',
      provider: 'tokenharbor',
      multiplier: null,
      contextTokens: 1000000,
      source: 'cli',
    });
    // 9router routes are not displayed, even when opencode.json still describes them.
    expect(enrichment.models?.some((model) => model.provider === '9router')).toBe(false);
    // A model missing from opencode.json keeps a null context instead of a made-up number.
    expect(enrichment.models?.find((model) => model.id === 'opencode/deepseek-v4.1-flash-free')).toMatchObject({
      provider: 'opencode', label: 'opencode/deepseek-v4.1-flash-free', contextTokens: null,
    });

    expect(enrichment.keyPools).toHaveLength(1);
    expect(enrichment.keyPools?.[0]).toMatchObject({ name: 'harbor', total: 5, exhausted: 1 });
    expect(enrichment.keyPools?.[0]?.remainingPct).toBeCloseTo(67.2, 5);

    const serialized = JSON.stringify(enrichment);
    expect(serialized).not.toContain('DO-NOT-LEAK');
    expect(serialized).not.toContain('sk-');
  });

  test('a stopped pool leaves the rest of the check intact', async () => {
    const port = await closedPort();
    const { config } = workspace(port);

    const enrichment = await enrichOpencode(context(config, models));

    expect(enrichment.keyPools?.[0]).toMatchObject({
      name: 'harbor', total: 0, remainingPct: null,
    });
    expect(enrichment.keyPools?.[0]?.limitLabel).toContain(POOL_DOWN_REASON);
    expect(enrichment.plan?.tier).toBe('byok');
    expect(enrichment.models).toHaveLength(4);
  });

  test('never contacts a non-loopback pool host from the enrichment hook', async () => {
    const spy = vi.spyOn(http, 'request');
    const { config } = workspace(20130, '203.0.113.9');

    const enrichment = await enrichOpencode(context(config, models));

    expect(spy).not.toHaveBeenCalled();
    expect(enrichment.keyPools?.[0]?.remainingPct).toBeNull();
    expect(enrichment.keyPools?.[0]?.limitLabel).toContain(POOL_HOST_REASON);
  });

  test('a failing models command keeps the plan and pool data, without throwing', async () => {
    const port = await serve(fixture);
    const { config } = workspace(port);

    const enrichment = await enrichOpencode(context(config, '', false));

    expect(enrichment.models).toBeUndefined();
    expect(enrichment.plan?.tier).toBe('byok');
    expect(enrichment.keyPools?.[0]?.total).toBe(5);
  });

  test('a missing key-pool.json yields no keyPools and falls back to opencode.json for the model', async () => {
    const directory = temporary();
    const keyPoolPath = path.join(directory, 'key-pool.json');
    writeFileSync(path.join(directory, 'opencode.json'), JSON.stringify({ model: 'harbor-pool/deepseek-v4.1-flash:free' }));

    const enrichment = await enrichOpencode(context(fleetConfig(keyPoolPath, []), models));

    expect(enrichment.keyPools).toBeUndefined();
    expect(enrichment.models).toHaveLength(4);
    expect(enrichment.currentModel?.id).toBe('harbor-pool/deepseek-v4.1-flash:free');
  });
});

describe('OpenCode model allowlist', () => {
  // `OpencodeSettings` stays private; the parser only reads these two fields.
  const settings = {
    providers: new Map<string, Map<string, { name: string | null; contextTokens: number | null }>>(),
    model: null,
  };

  test('keeps only opencode, tokenharbor and harbor-pool models, in order', () => {
    const stdout = [
      'opencode/deepseek-v4.1-flash-free',
      'tokenharbor/deepseek-v4.1-flash:free',
      'tokenharbor/deepseek-v4.1-flash-1017',
      'harbor-pool/deepseek-v4.1-flash:free',
      '9router/ag/gemini-4-argon-high',
    ].join('\n');

    expect(parseModels(stdout, settings).map((model) => model.id)).toEqual([
      'opencode/deepseek-v4.1-flash-free',
      'tokenharbor/deepseek-v4.1-flash:free',
      'tokenharbor/deepseek-v4.1-flash-1017',
      'harbor-pool/deepseek-v4.1-flash:free',
    ]);
  });

  test('a 9router-only listing leaves no models to show', () => {
    expect(parseModels('9router/ag/gemini-4-argon-high', settings)).toEqual([]);
  });
});
