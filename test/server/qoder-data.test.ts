import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { buildDashboardCheck, redactSensitive, type CommandProbeResult } from '../../server/dashboard.js';
import { enrichQoder, parseQoderStatus } from '../../server/dashboard/parsers/qoder.js';
import { collectQoderPickerScreens, createQoderPickerWalk } from '../../server/terminal-status.js';
import type { DashboardEnrichmentContext } from '../../server/dashboard/parsers/common.js';
import { applyModelCatalog, modelKey, readModelCatalog } from '../../server/model-catalog.js';
import type { FleetConfig } from '../../server/config.js';
import type { ModelOffer } from '../../shared/dashboard.js';

const PICKER = readFileSync(
  new URL('../../server/adapters/__fixtures__/qodercli/model-picker.txt', import.meta.url),
  'utf8',
);

const directories: string[] = [];
const temporary = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fleet-qoder-'));
  directories.push(dir);
  return dir;
};
afterAll(() => { for (const dir of directories) rmSync(dir, { recursive: true, force: true }); });

/** A PTY probe: terminalStatus labels its screen `bin → /usage → /model`. */
const tty = (text: string, command = 'qodercli.exe → /usage → /model', ok = true): CommandProbeResult =>
  ({ command, kind: 'status', ok, exitCode: ok ? 0 : null, stdout: text, stderr: ok ? '' : 'timeout' });
const json = (payload: unknown): CommandProbeResult =>
  ({ command: 'qodercli status -o json', kind: 'status', ok: true, exitCode: 0, stdout: typeof payload === 'string' ? payload : JSON.stringify(payload), stderr: '' });

const config = (): FleetConfig => {
  const agent = { bin: process.execPath, maxParallel: 2, extraArgs: [] as string[] };
  return {
    port: 4500,
    agents: { codex: { ...agent }, qodercli: { ...agent }, agy: { ...agent }, opencode: { ...agent } },
    maxParallelTotal: 4,
    timeouts: { totalMin: 1, idleMin: 1 },
  };
};

const find = (models: ModelOffer[] | undefined, id: string) => models?.find(model => model.id === id);

function contextFor(overrides: Partial<DashboardEnrichmentContext> & { results: CommandProbeResult[] }): DashboardEnrichmentContext {
  const results = overrides.results;
  const check = buildDashboardCheck('qodercli', true, results, 1);
  return {
    agent: 'qodercli', bin: process.execPath, directory: temporary(), config: config(), check,
    redact: redactSensitive,
    runCommand: async (args, kind = 'status') => ({ command: `qodercli ${args.join(' ')}`, kind, ok: true, exitCode: 0, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('Qoder /model screen (fixture qodercli 1.1.81)', () => {
  const parsed = parseQoderStatus([tty(PICKER)], redactSensitive);
  const models = parsed.models;

  test('reads every priced row of the picker, both groups, without inventing rows', () => {
    expect(models).toHaveLength(14);
    expect(new Set(models!.map(model => model.id)).size).toBe(14);
    for (const model of models!) expect(model.source).toBe('pty');
  });

  test('maps the verified explicit rates of the captured screen', () => {
    for (const [id, multiplier] of [['Sonus', 8], ['Cantus', 4], ['Kimi-K3.1-Pro', 1], ['Kimi-K2.8-Preview', 0.8],
      ['GLM-5.3', 0.8], ['GLM-5.3-Flash', 0.1], ['DeepSeek-V4-Pro', 0.5], ['DeepSeek-Flash', 0.1],
      ['Auto', 0.5], ['Ultimate', 2], ['Fast', 0.8], ['Efficient', 0.3]] as const) {
      expect(find(models, id)).toMatchObject({ multiplier, originalMultiplier: null, promo: null });
    }
  });

  test('treats the struck-through price as original and the last price as current', () => {
    expect(find(models, 'Qwen3.8-Max')).toMatchObject({ multiplier: 0.2, originalMultiplier: 0.5 });
    expect(find(models, 'Qwen3.8-Max')!.promo).toBeTruthy();
    expect(find(models, 'Qwen3.8-Flash')).toMatchObject({ multiplier: 0, originalMultiplier: 0.1 });
  });

  test('a discounted-to-zero rate stays free (0), never unknown (null)', () => {
    expect(find(models, 'Qwen3.8-Flash')!.multiplier).toBe(0);
    expect(find(models, 'Qwen3.8-Max')!.multiplier).not.toBeNull();
  });

  test('never reports a promo expiry the CLI did not print', () => {
    for (const model of models!) if (model.promo) expect(model.promo).not.toMatch(/\d{1,2}\/\d{1,2}|đến|to \d|until/i);
  });

  test('reads context size and strips cursor/selection glyphs from model names', () => {
    expect(find(models, 'Qwen3.8-Flash')).toMatchObject({ contextTokens: 1_000_000 });
    expect(find(models, 'Sonus')).toMatchObject({ contextTokens: 200_000 });
    expect(find(models, 'Qwen3.8-Max')!.id).toBe('Qwen3.8-Max');
    expect(models!.some(model => /[❯▼✓◑■▦←→]/.test(model.id))).toBe(false);
  });

  test('an unseen cursor glyph still yields the model name', () => {
    const row = ' ▶ Kimi-K9.0  ■■□ High  ▦ 400K   2.50x Credit';
    const parsed = parseQoderStatus([tty(` Model ·  Default (4)   New (11)   Custom (0)\n${row}\n`)], redactSensitive);
    expect(parsed.models).toEqual([expect.objectContaining({ id: 'Kimi-K9.0', multiplier: 2.5, contextTokens: 400_000 })]);
  });

  test('rates come from the screen, not from constants baked into the parser', () => {
    const synthetic = PICKER
      .replace('8.00x Credit', '7.77x Credit')
      .replace('0.50x 0.20x Credit', '1.25x 9.99x Credit');
    const moved = parseQoderStatus([tty(synthetic)], redactSensitive).models;
    expect(find(moved, 'Sonus')!.multiplier).toBe(7.77);
    expect(find(moved, 'Qwen3.8-Max')).toMatchObject({ multiplier: 9.99, originalMultiplier: 1.25 });
    expect(find(parseQoderStatus([tty(PICKER)], redactSensitive).models, 'Sonus')!.multiplier).toBe(8);
  });

  test('strips ANSI before matching, so the same screen still parses with escapes present', () => {
    const coloured = PICKER.replace('8.00x Credit', '\x1b[9m8.00x \x1b[29m6.50x Credit');
    expect(find(parseQoderStatus([tty(coloured)], redactSensitive).models, 'Sonus'))
      .toMatchObject({ multiplier: 6.5, originalMultiplier: 8 });
  });

  test('parses the multi-screen stdout terminalStatus now returns', () => {
    const usage = PICKER.slice(0, PICKER.indexOf('██████', 1));
    const newGroup = PICKER.slice(PICKER.indexOf(' Model ·'), PICKER.indexOf('██████', PICKER.indexOf(' Model ·')));
    const defaultGroup = PICKER.slice(PICKER.lastIndexOf(' Model ·'));
    const customGroup = ' Model ·  Default (4)   New (11)   Custom (0)\n ❯ [+] Add custom model...\n  No models in this group.\n';
    const joined = [usage, newGroup, defaultGroup, customGroup].join('\n\n');
    const check = buildDashboardCheck('qodercli', true, [json({ logged_in: true, username: 'Tester', user_type: 'personal_professional_trial' }), tty(joined)], 1);
    expect(check.models).toHaveLength(14);
    expect(check.plan).toMatchObject({ name: 'Pro Trial', tier: 'trial' });
    expect(check.currentModel).toMatchObject({ id: 'Qwen3.8-Flash', effort: 'Extra High' });
    expect(check.quotaWindows).toHaveLength(2);
    expect(check.details!.filter(detail => detail.label === 'Hết hạn gói')).toHaveLength(1);
    expect(check.credits).toMatchObject({ remaining: 555, unit: 'credits' });
    expect(check.quota).toMatchObject({ remaining: 0, unit: 'credits' });
  });

  test('a repeated screen does not duplicate models or windows', () => {
    const parsed = parseQoderStatus([tty(`${PICKER}\n\n${PICKER}`)], redactSensitive);
    expect(parsed.models).toHaveLength(14);
    expect(parsed.quotaWindows).toHaveLength(2);
  });

  test('an absent picker screen yields no models and no fabricated prices', () => {
    const usage = parseQoderStatus([tty('  Plan Credits Used         : 300/300\n  Add-on Credits Used       : 245/800\n')], redactSensitive);
    expect(usage.models).toBeUndefined();
    expect(usage.currentModel).toBeUndefined();
    expect(usage.highlights!.join(' ')).toMatch(/\/model|chưa/);
  });

  test('a malformed or unavailable picker never throws and keeps credit parsing alive', () => {
    const broken = parseQoderStatus([
      json({ logged_in: true, user_type: 'personal_professional_trial' }),
      tty(' Model ·  Default (4)   New (11)   Custom (0)\n  No models in this group.\n  Plan Credits Used : 30/300\n'),
    ], redactSensitive);
    expect(broken.models ?? []).toHaveLength(0);
    expect(broken.credits).toMatchObject({ remaining: 270, unit: 'credits' });
  });
});

describe('Qoder plan and quota windows', () => {
  test('maps personal_professional_trial to the trial tier with the CLI display name', () => {
    const check = buildDashboardCheck('qodercli', true, [json({ logged_in: true, user_type: 'personal_professional_trial' }), tty(PICKER)], 1);
    expect(check.plan).toMatchObject({ name: 'Pro Trial', tier: 'trial' });
  });

  test('derives the plan name from user_type when the screen has no display name', () => {
    const parsed = parseQoderStatus([json({ logged_in: true, user_type: 'personal_professional_trial' })], redactSensitive);
    expect(parsed.plan).toMatchObject({ name: 'Pro Trial', tier: 'trial', renewsAt: null });
  });

  test('prefers the plan name the CLI prints over any derived label', () => {
    const parsed = parseQoderStatus([json({ logged_in: true, user_type: 'personal_professional_trial' }),
      tty('  Qoder Plan                : Team Edition\n  Plan Credits Used         : 10/300\n')], redactSensitive);
    expect(parsed.plan!.name).toBe('Team Edition');
  });

  test('classifies tiers without guessing an unknown plan', () => {
    const tier = (userType: string) => parseQoderStatus([json({ logged_in: true, user_type: userType })], redactSensitive).plan!.tier;
    expect(tier('personal_professional_trial')).toBe('trial');
    expect(tier('personal_free_user')).toBe('free');
    expect(tier('pro_plus')).toBe('plus');
    expect(tier('professional')).toBe('pro');
    expect(tier('enterprise_unlim')).toBe('unknown');
    expect(parseQoderStatus([json({ logged_in: true, user_type: '' })], redactSensitive).plan).toBeUndefined();
  });

  test('exposes plan and add-on credits as plan windows with percentages', () => {
    const check = buildDashboardCheck('qodercli', true, [tty(PICKER)], 1);
    expect(check.quotaWindows).toContainEqual({ group: 'Credit gói', window: 'plan', remainingPct: 0, used: 300, limit: 300, unit: 'credits', resetAt: null });
    expect(check.quotaWindows).toContainEqual({ group: 'Credit bổ sung', window: 'plan', remainingPct: 69.38, used: 245, limit: 800, unit: 'credits', resetAt: null });
  });

  test('an unknown denominator gives a null percentage, never 0%', () => {
    const parsed = parseQoderStatus([tty('  Org Resource Package      : N/A\n')], redactSensitive);
    expect(parsed.quotaWindows).toBeUndefined();
  });

  test('keeps the plan expiry as a detail instead of claiming it is a renewal date', () => {
    const parsed = parseQoderStatus([json({ logged_in: true, user_type: 'personal_professional_trial' }), tty(PICKER)], redactSensitive);
    expect(parsed.plan!.renewsAt).toBeNull();
    expect(parsed.details).toContainEqual({ label: 'Hết hạn gói', value: 'Nov 10, 2026, 20:45:26 GMT+7' });
  });

  test('reports the current model with its effort level', () => {
    const check = buildDashboardCheck('qodercli', true, [tty(PICKER)], 1);
    expect(check.currentModel).toMatchObject({ id: 'Qwen3.8-Flash', label: 'Qwen3.8-Flash', effort: 'Extra High' });
  });

  test('warns when the picker advertises more models than the viewport shows', () => {
    expect(parseQoderStatus([tty(PICKER)], redactSensitive).highlights!.join(' ')).toMatch(/14.{0,40}15|15.{0,40}14/s);
  });

  test('survives the ConPTY-squeezed form without inventing a plan name', () => {
    const squeezed = 'QoderPlan:ProTrialPlanCreditsUsed:300/300Add-onCreditsUsed:245/800OrgResourcePackage:N/A';
    const parsed = parseQoderStatus([json({ logged_in: true, user_type: 'pro_trial' }), tty(squeezed)], redactSensitive);
    expect(parsed.credits).toMatchObject({ remaining: 555, unit: 'credits' });
    expect(parsed.plan).toMatchObject({ name: 'Pro Trial', tier: 'trial' });
    expect(parsed.models).toBeUndefined();
  });

  test('no token material reaches the structured fields', () => {
    const check = buildDashboardCheck('qodercli', true, [json({ logged_in: true, username: 'Tester', user_type: 'personal_professional_trial' }), tty(PICKER)], 1);
    const dump = JSON.stringify({ plan: check.plan, models: check.models, quotaWindows: check.quotaWindows, currentModel: check.currentModel });
    expect(dump).not.toMatch(/eyJ|sk-[A-Za-z0-9_-]{6,}|Bearer /i);
  });
});

describe('model catalog (user-editable overrides)', () => {
  test('a missing catalog is not an error', () => {
    const catalog = readModelCatalog(temporary());
    expect(catalog).toMatchObject({ found: false, error: null, verifiedAt: null });
    expect(catalog.entries).toHaveLength(0);
  });

  test('reads a map keyed by model name and keeps verifiedAt', () => {
    const dir = temporary();
    writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
      verifiedAt: '2026-11-01',
      models: { 'Qwen3.8-Flash': { multiplier: 0.05 }, 'Brand-New': { multiplier: 1.5, label: 'Brand New' } },
    }), 'utf8');
    const catalog = readModelCatalog(dir);
    expect(catalog).toMatchObject({ found: true, error: null, verifiedAt: '2026-11-01' });
    expect(catalog.entries).toHaveLength(2);
  });

  test('reads an array catalog too', () => {
    const dir = temporary();
    writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
      verifiedAt: '2026-10-31',
      models: [{ id: 'Sonus', multiplier: 3 }],
    }), 'utf8');
    expect(readModelCatalog(dir).entries[0]).toMatchObject({ id: 'Sonus', multiplier: 3 });
  });

  test('rejects a malformed file and non-numeric multipliers without throwing', () => {
    const broken = temporary();
    writeFileSync(path.join(broken, 'model-catalog.json'), '{oops', 'utf8');
    expect(readModelCatalog(broken)).toMatchObject({ found: true, entries: [] });
    expect(readModelCatalog(broken).error).toBeTruthy();

    const dir = temporary();
    writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
      models: [{ id: 'A', multiplier: 'cheap' }, { id: 'B', multiplier: -1 }, { id: 'C', multiplier: 0 }, { id: 'D' }],
    }), 'utf8');
    const catalog = readModelCatalog(dir);
    expect(catalog.entries.map(entry => entry.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(catalog.entries[0]!.multiplier).toBeNull();
    expect(catalog.entries[1]!.multiplier).toBeNull();
    expect(catalog.entries[2]!.multiplier).toBe(0);
    expect(catalog.entries[3]!.multiplier).toBeNull();
  });

  test('overrides a CLI rate, marks the source and keeps untouched rows', () => {
    const models = parseQoderStatus([tty(PICKER)], redactSensitive).models!;
    const dir = temporary();
    writeFileSync(path.join(dir, 'model-catalog.json'), JSON.stringify({
      verifiedAt: '2026-11-02',
      models: [{ id: 'Qwen3.8-Max', multiplier: 0.3, originalMultiplier: 0.9, promo: 'Khuyến mãi anh/chị ghi' }],
    }), 'utf8');
    const merged = applyModelCatalog(models, readModelCatalog(dir));
    expect(find(merged, 'Qwen3.8-Max')).toMatchObject({ multiplier: 0.3, originalMultiplier: 0.9, source: 'catalog' });
    expect(find(merged, 'Sonus')).toMatchObject({ multiplier: 8, source: 'pty' });
    expect(merged).toHaveLength(models.length);
  });

  test('adds catalog-only models as priced offers and matches case/spacing insensitively', () => {
    const models = parseQoderStatus([tty(PICKER)], redactSensitive).models!;
    const merged = applyModelCatalog(models, {
      file: 'x', found: true, verifiedAt: null, error: null,
      entries: [{ id: '  qwen3.8 MAX ', multiplier: 0.42 }, { id: 'Only Catalog', multiplier: 2 }],
    });
    expect(find(merged, 'Qwen3.8-Max')!.multiplier).toBe(0.42);
    expect(find(merged, 'Only Catalog')).toMatchObject({ multiplier: 2, source: 'catalog' });
    expect(merged).toHaveLength(models.length + 1);
  });

  test('modelKey ignores case, spacing and punctuation', () => {
    expect(modelKey('  Qwen3.8-Flash ✓ ')).toBe(modelKey('qwen 3.8 flash'));
    expect(modelKey('DeepSeek-V4-Pro')).toBe('deepseekv4pro');
  });
});

describe('enrichQoder', () => {
  test('adds --list-models entries with a null multiplier when no rate is known', async () => {
    const listing = ['Auto', 'Ultimate', 'Qwen3.8-Flash', 'GLM-5.3-Flash', 'MiniMax-M3', 'Available models:'].join('\n');
    const enriched = await enrichQoder(contextFor({
      results: [json({ logged_in: true, user_type: 'personal_professional_trial' }), tty(PICKER)],
      runCommand: async () => ({ command: 'qodercli --list-models', kind: 'usage', ok: true, exitCode: 0, stdout: listing, stderr: '' }),
    }));
    const ids = enriched.models!.map(model => model.id);
    expect(ids).toContain('MiniMax-M3');
    expect(find(enriched.models, 'MiniMax-M3')).toMatchObject({ multiplier: null, source: 'cli' });
    expect(enriched.models!.filter(model => model.id === 'Auto')).toHaveLength(1);
    expect(find(enriched.models, 'Auto')!.multiplier).toBe(0.5);
    expect(enriched.models!.filter(model => model.id === 'Qwen3.8-Flash')).toHaveLength(1);
    expect(ids).not.toContain('Available models:');
  });

  test('a failing or empty --list-models leaves picker data intact', async () => {
    const failing = await enrichQoder(contextFor({
      results: [tty(PICKER)],
      runCommand: async () => ({ command: 'qodercli --list-models', kind: 'usage', ok: false, exitCode: 1, stdout: '', stderr: 'unknown option' }),
    }));
    expect(failing.models).toHaveLength(14);
    const empty = await enrichQoder(contextFor({ results: [tty(PICKER)] }));
    expect(empty.models).toHaveLength(14);
  });

  test('catalog overrides win over the screen and the update date is surfaced for the UI', async () => {
    const directory = temporary();
    writeFileSync(path.join(directory, 'model-catalog.json'), JSON.stringify({
      verifiedAt: '2026-11-02',
      models: [{ id: 'Ultimate', multiplier: 1.1 }],
    }), 'utf8');
    const enriched = await enrichQoder(contextFor({ results: [tty(PICKER)], directory }));
    expect(find(enriched.models, 'Ultimate')).toMatchObject({ multiplier: 1.1, source: 'catalog' });
    expect(enriched.highlights!.join(' ')).toMatch(/catalog/i);
    expect(enriched.highlights!.join(' ')).toMatch(/02\/11/);
  });

  test('a catalog rate also fills models the screen never priced', async () => {
    const directory = temporary();
    writeFileSync(path.join(directory, 'model-catalog.json'), JSON.stringify({
      verifiedAt: '2026-11-01',
      models: [{ id: 'MiniMax-M3', multiplier: 0.7 }],
    }), 'utf8');
    const enriched = await enrichQoder(contextFor({
      results: [tty(PICKER)],
      directory,
      runCommand: async () => ({ command: 'qodercli --list-models', kind: 'usage', ok: true, exitCode: 0, stdout: 'MiniMax-M3', stderr: '' }),
    }));
    expect(find(enriched.models, 'MiniMax-M3')).toMatchObject({ multiplier: 0.7, source: 'catalog' });
  });

  test('enrichment only returns structured v3 fields and never invents a plan', async () => {
    const enriched = await enrichQoder(contextFor({ results: [tty(PICKER)] }));
    expect(Object.keys(enriched).sort()).toEqual(['currentModel', 'highlights', 'models', 'plan', 'quotaWindows']);
    expect(enriched).not.toHaveProperty('credits');
    expect(enriched).not.toHaveProperty('quota');
    expect(enriched.plan).toMatchObject({ tier: 'trial' });
  });

  test('a catalog file is never created by reading', async () => {
    const directory = temporary();
    await enrichQoder(contextFor({ results: [tty(PICKER)], directory }));
    expect(() => readFileSync(path.join(directory, 'model-catalog.json'), 'utf8')).toThrow();
  });
});

describe('qodercli terminal probe', () => {
  test('waits for a priced picker row and ignores the plain usage screen', async () => {
    const { isQoderPickerScreen, isQoderUsageScreen } = await import('../../server/terminal-status.js');
    expect(isQoderUsageScreen(PICKER)).toBe(true);
    expect(isQoderPickerScreen(PICKER)).toBe(true);
    expect(isQoderPickerScreen('  Plan Credits Used : 300/300\n  Add-on Credits Used : 245/800\n')).toBe(false);
    expect(isQoderUsageScreen(' Model ·  Default (4)\n')).toBe(false);
    expect(isQoderPickerScreen(' ❯ [+] Add custom model...\n  No models in this group.\n')).toBe(false);
  });

  test('advertises both slash commands of the qodercli branch', async () => {
    const { statusProbeCommands } = await import('../../server/terminal-status.js');
    expect(statusProbeCommands('qodercli')).toEqual(['/usage', '/model']);
    expect(statusProbeCommands('codex')).toEqual(['/status']);
    expect(statusProbeCommands('agy')).toEqual(['/help', '/usage', '/credits']);
  });
});

describe('qodercli /model picker traversal (empty Custom is one visited group, not the end)', () => {
  // The three group screens as the picker paints them (Tab order Default → New → Custom).
  const newGroup = PICKER.slice(PICKER.indexOf(' Model ·'), PICKER.indexOf('██████', PICKER.indexOf(' Model ·')));
  const defaultGroup = PICKER.slice(PICKER.lastIndexOf(' Model ·'));
  const customGroup = ' Model ·  Default (4)   New (11)   Custom (0)\n ❯ [+] Add custom model...\n  No models in this group.\n';

  // A scripted stand-in for the PTY: `read` returns the next group screen, `tab` advances.
  const drive = (sequence: string[]) => {
    let i = 0, tabs = 0;
    const screens = collectQoderPickerScreens(
      () => sequence[Math.min(i, sequence.length - 1)],
      () => { i++; tabs++; },
    );
    return { screens, tabs };
  };

  test('New(priced) → Custom(empty) → Default(priced) retains BOTH priced groups', () => {
    expect(newGroup).toContain('Sonus');                 // group the picker opens on
    expect(defaultGroup).toContain('Auto');               // group that used to be skipped
    const { screens } = drive([newGroup, customGroup, defaultGroup]);
    expect(screens).toEqual([newGroup, defaultGroup]);     // empty Custom traversed but not captured
    const models = parseQoderStatus([tty(screens.join('\n\n'))], redactSensitive).models!;
    expect(models).toHaveLength(14);
    expect(find(models, 'Sonus')!.multiplier).toBe(8);       // from New
    expect(find(models, 'Auto')!.multiplier).toBe(0.5);      // from Default — lost before the fix
  });

  test('Custom(empty) → Default(priced) → New(priced) retains BOTH priced groups', () => {
    const { screens } = drive([customGroup, defaultGroup, newGroup]);
    expect(screens).toEqual([defaultGroup, newGroup]);
    const models = parseQoderStatus([tty(screens.join('\n\n'))], redactSensitive).models!;
    expect(find(models, 'Auto')!.multiplier).toBe(0.5);
    expect(find(models, 'Sonus')!.multiplier).toBe(8);
    expect(models).toHaveLength(14);
  });

  test('the first sight of the empty group is visited, not a completion signal', () => {
    const walk = createQoderPickerWalk();
    expect(walk.observe(customGroup)).toEqual({ kind: 'empty', record: false, stop: false });
    expect(walk.screens).toHaveLength(0);
  });

  test('traversal terminates and captures nothing when no group ever paints', () => {
    let reads = 0;
    const screens = collectQoderPickerScreens(() => `Type your message ${reads++}\n`, () => {});
    expect(screens).toEqual([]);
    expect(reads).toBeLessThanOrEqual(6 * 4 + 1);
  });

  test('a picker that re-paints the same two groups is still bounded and deduped', () => {
    let i = 0;
    const cycle = [newGroup, customGroup, defaultGroup];
    const screens = collectQoderPickerScreens(() => cycle[i++ % cycle.length], () => {});
    expect(screens).toEqual([newGroup, defaultGroup]);
    expect(i).toBeLessThanOrEqual(6 * 4 + 1);
  });
});
