import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { buildDashboardCheck, redactSensitive, type CommandProbeResult } from '../../server/dashboard.js';
import { enrichCodex, parseCodexStatus } from '../../server/dashboard/parsers/codex.js';
import { enrichAgy, parseAgyStatus } from '../../server/dashboard/parsers/agy.js';
import type { DashboardEnrichmentContext } from '../../server/dashboard/parsers/common.js';

const fixture = (agent: string, name: string) => readFileSync(new URL(`../../server/adapters/__fixtures__/${agent}/${name}`, import.meta.url), 'utf8');
const probe = (agent: string, stdout: string): CommandProbeResult => ({ command: `${agent}.exe → /usage`, kind: 'status', stdout, stderr: '', ok: true, exitCode: 0 });
function context(agent: 'codex' | 'agy', results: CommandProbeResult[] = []): DashboardEnrichmentContext {
  const settings = { bin: 'C:\\CLI\\agent.exe', maxParallel: 1, extraArgs: [] };
  return { agent, bin: settings.bin, directory: 'C:\\Fleet data',
    config: { port: 4500, maxParallelTotal: 1, timeouts: { totalMin: 1, idleMin: 1 }, agents: { codex: settings, qodercli: settings, agy: settings, opencode: settings } },
    results, check: buildDashboardCheck(agent, true, results, 1), redact: redactSensitive,
    runCommand: vi.fn(async (): Promise<CommandProbeResult> => ({ command: 'agy models', kind: 'status', stdout: fixture('agy', 'models.txt'), stderr: '', ok: true, exitCode: 0 })),
  };
}
const jwt = (payload: object) => `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
const local = (auth: string | null, config = '') => ({ codexHome: 'C:\\Synthetic user\\.codex', readText: vi.fn(async (file: string) => {
  if (path.basename(file) === 'auth.json' && auth !== null) return auth;
  if (path.basename(file) === 'config.toml') return config;
  throw Object.assign(new Error('missing'), { code: 'ENOENT' });
}) });

describe('Codex dashboard data', () => {
  test('maps real captured windows once, retaining zero and explicit reset labels', () => {
    const parsed = parseCodexStatus([probe('codex', fixture('codex', 'dashboard-status.txt'))], redactSensitive);
    expect(parsed.quotaWindows).toEqual([
      { group: 'Codex', window: '5h', remainingPct: 38, unit: 'percent', resetAt: '8:30 PM' },
      { group: 'Codex', window: 'week', remainingPct: 36, unit: 'percent', resetAt: '3:17 PM on 4 Nov' },
    ]);
    expect(parseCodexStatus([probe('codex', '5h limit: 0% left\nWeekly limit: 125% left')], redactSensitive).quotaWindows)
      .toEqual([{ group: 'Codex', window: '5h', remainingPct: 0, unit: 'percent', resetAt: null }]);
  });
  test('decodes only the plan claim; model and effort come from root TOML strings', async () => {
    const token = jwt({ email: 'private@example.invalid', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', unrelated: 'secret' } });
    const options = local(JSON.stringify({ tokens: { id_token: token, access_token: 'sk-private-credential' } }),
      '# settings\nmodel = "gpt-test#variant" # comment\nmodel_reasoning_effort = \'high\' # comment\n[profiles.other]\nmodel = "wrong-model"');
    const ctx = context('codex', [probe('codex', 'Account: user@example.invalid (Plus)')]);
    const data = await enrichCodex(ctx, options);
    expect(data.plan).toMatchObject({ name: 'ChatGPT Plus', tier: 'plus' });
    expect(data.currentModel).toEqual({ id: 'gpt-test#variant', label: 'gpt-test#variant', effort: 'high' });
    const output = JSON.stringify({ ...ctx.check, ...data });
    for (const secret of [token, 'eyJ', 'sk-', 'private@example.invalid', 'unrelated']) expect(output).not.toContain(secret);
    expect(ctx.check.probes.every(p => !p.output?.includes('eyJ'))).toBe(true);
    expect(ctx.runCommand).not.toHaveBeenCalled();
  });
  test.each(['free', 'trial', 'pro', 'team'])('maps an explicit %s plan without inferring renewal from token expiry', async tier => {
    const data = await enrichCodex(context('codex'), local(JSON.stringify({ tokens: { id_token: jwt({ chatgpt_plan_type: tier, exp: 123 }) } })));
    expect(data.plan?.tier).toBe(tier);
    expect(data.plan?.renewsAt).toBeUndefined();
  });
  test.each(['{invalid', '{}', '{"tokens":{"id_token":"invalid"}}'])('missing or invalid auth stays unknown: %s', async auth => {
    const data = await enrichCodex(context('codex'), local(auth));
    expect(data.plan?.tier).toBe('unknown');
    expect(data.currentModel).toBeUndefined();
  });
  test('missing local files and secret-like or malformed strings never leak raw config', async () => {
    const missing = local(null);
    expect((await enrichCodex(context('codex'), missing)).plan?.tier).toBe('unknown');
    const data = await enrichCodex(context('codex'), local('{}', 'model="sk-secret-value"\nmodel_reasoning_effort="high"'));
    expect(data.currentModel).toBeUndefined();
    expect(JSON.stringify(data)).not.toContain('sk-');
  });
  test('supports quoted root keys, escaped strings and literal values while ignoring table values', async () => {
    const data = await enrichCodex(context('codex'), local('{}', '"model" = "gpt-\\u0074est"\n\'model_reasoning_effort\' = \'xhigh\'\n[profile]\nmodel_reasoning_effort = "low"'));
    expect(data.currentModel).toEqual({ id: 'gpt-test', label: 'gpt-test', effort: 'xhigh' });
  });
});

describe('AGY dashboard data', () => {
  test('maps all five captured buckets independently and extracts only an explicit plan header', () => {
    const parsed = parseAgyStatus([probe('agy', fixture('agy', 'dashboard-status.txt'))], redactSensitive);
    expect(parsed.quotaWindows).toHaveLength(5);
    expect(parsed.quotaWindows).toContainEqual({ group: 'GEMINI 4 ARGON', window: 'week', remainingPct: 6.16, unit: 'percent', resetAt: 'Làm mới sau 67h 50m' });
    expect(parsed.plan).toMatchObject({ name: 'Google AI Pro', tier: 'pro' });
    expect(parsed.quota.remaining).toBe(6.16);
    expect(parsed.credits.remaining).toBeNull();
  });
  test('does not fabricate a plan from explanatory Pro/Ultra prose or missing buckets', () => {
    const parsed = parseAgyStatus([probe('agy', 'GEMINI 4 ARGON\nFor paid Pro plans, Argon quota is separate.\nWeekly Limit Remaining\nUnavailable')], redactSensitive);
    expect(parsed.plan?.tier).toBe('unknown');
    expect(parsed.quotaWindows).toEqual([]);
  });
  test('uses a fixed models argv; retains all model ids with unknown prices', async () => {
    const ctx = context('agy');
    const data = await enrichAgy(ctx);
    expect(ctx.runCommand).toHaveBeenCalledWith(['models']);
    expect(data.models).toHaveLength(13);
    expect(data.models?.[0]).toMatchObject({ id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)', multiplier: null, source: 'cli' });
    expect(data.models?.every(m => m.multiplier === null)).toBe(true);
  });
  test('ignores command failure and malformed model output without inventing offers', async () => {
    const ctx = context('agy');
    ctx.runCommand = vi.fn(async (): Promise<CommandProbeResult> => ({ command: 'agy models', kind: 'status', stdout: 'Error: login needed\ninvalid\nabc\t\nvalid\tA model\nvalid\tDuplicate', stderr: '', ok: true, exitCode: 0 }));
    expect((await enrichAgy(ctx)).models).toEqual([{ id: 'valid', label: 'A model', multiplier: null, source: 'cli' }]);
    ctx.runCommand = vi.fn(async (): Promise<CommandProbeResult> => ({ command: 'agy models', kind: 'status', stdout: 'valid\tA model', stderr: 'login needed', ok: false, exitCode: 1 }));
    expect((await enrichAgy(ctx)).models).toEqual([]);
    ctx.runCommand = vi.fn(async () => { throw new Error('command unavailable'); });
    expect((await enrichAgy(ctx)).models).toEqual([]);
  });
});
