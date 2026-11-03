import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { DashboardSnapshot, DashboardTool } from '../../shared/dashboard.js';
import type { ObservabilitySnapshot, ResourceSample } from '../../shared/observability.js';
import type { Plan } from '../../shared/types.js';

/**
 * Regression coverage for T7 (Trang Tài nguyên & sử dụng).
 * Every number is synthetic; no CLI is started and no user data is read.
 */

test.beforeAll(async () => { await mkdir('.tmp/ui-qa', { recursive: true }); });

function sample(index: number): ResourceSample {
  const memory = (360 + index * 7) * 1024 ** 2;
  return {
    sampledAt: 1_760_000_000_000 + index * 5_000,
    scope: 'server-only',
    cpuPercent: 6 + ((index * 13) % 48),
    memoryBytes: memory,
    peakMemoryBytes: memory + 32 * 1024 ** 2,
    cpuTimeMs: 1_000 + index * 250,
    processCount: 3,
    gpu: null,
  };
}

const PLAN: Plan = {
  id: 'plan-usage',
  name: 'Usage fixture plan',
  slug: 'usage-fixture-plan',
  repoPath: 'C:\\fixtures\\usage-repo',
  baseBranch: 'main',
  createdAt: 1_760_000_000_000,
};

/** Snapshot with no runs at all: every metric must stay "chưa có dữ liệu". */
function emptySnapshot(): ObservabilitySnapshot {
  const resource = sample(0);
  return {
    sampledAt: 1_760_000_100_000,
    app: { version: '2.3.0', platform: 'win32', nodeVersion: '24.0.0', uptimeMs: 120_000, desktop: false },
    resource,
    history: [],
    system: { totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 16 * 1024 ** 3, logicalCpuCount: 16 },
    usage: {
      planId: null,
      taskCount: 0,
      runCount: 0,
      completedRuns: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      credits: null,
      reportedCredits: null,
      coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 0 },
      resources: { measuredRuns: 0, peakMemoryBytes: null, observedCpuTimeMs: null },
    },
    plans: [],
    runs: [],
    activeJobs: [],
    usageByTool: [],
    usageByModel: [],
    notes: ['Token, USD và credit chỉ cộng số liệu agent báo; thiếu dữ liệu được giữ là chưa rõ.'],
  };
}

/** Snapshot with measured numbers for every panel. */
function dataSnapshot(): ObservabilitySnapshot {
  const history = Array.from({ length: 12 }, (_, index) => sample(index));
  const coverage = { tokenRuns: 3, costRuns: 2, creditRuns: 2, totalRuns: 4 };
  return {
    sampledAt: 1_760_000_100_000,
    app: { version: '2.3.0', platform: 'win32', nodeVersion: '24.0.0', uptimeMs: 3_600_000, desktop: false },
    resource: history.at(-1)!,
    history,
    system: { totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 20 * 1024 ** 3, logicalCpuCount: 16 },
    usage: {
      planId: null,
      taskCount: 3,
      runCount: 4,
      completedRuns: 3,
      inputTokens: 128_400,
      outputTokens: 32_600,
      costUsd: 0.0412,
      credits: 12,
      reportedCredits: 18,
      coverage,
      resources: { measuredRuns: 3, peakMemoryBytes: 1.5 * 1024 ** 3, observedCpuTimeMs: 125_000 },
    },
    plans: [{ planId: PLAN.id, taskCount: 3, runCount: 4, completedRuns: 3, inputTokens: 128_400, outputTokens: 32_600, costUsd: 0.0412, credits: 12, reportedCredits: 18, coverage, resources: { measuredRuns: 3, peakMemoryBytes: 1.5 * 1024 ** 3, observedCpuTimeMs: 125_000 } }],
    runs: [],
    activeJobs: [],
    usageByTool: [
      { agent: 'codex', runCount: 2, inputTokens: 90_000, outputTokens: 20_000, costUsd: 0.03, credits: 8, reportedCredits: 8, coverage: { tokenRuns: 2, costRuns: 2, creditRuns: 1, totalRuns: 2 }, models: [{ name: 'gpt-5.1-codex', provider: 'openai', source: 'reported', generic: false }] },
      { agent: 'qodercli', runCount: 1, inputTokens: 24_400, outputTokens: 9_600, costUsd: 0.005, credits: 4, reportedCredits: 4, coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 }, models: [{ name: 'qwen3.8-flash', provider: 'qoder', source: 'reported', generic: false }] },
      { agent: 'opencode', runCount: 1, inputTokens: 14_000, outputTokens: 3_000, costUsd: 0.0062, credits: null, reportedCredits: 6, coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 }, models: [{ name: 'tokenharbor/deepseek-v4.1-flash-1017', provider: 'tokenharbor', source: 'reported', generic: false }] },
    ],
    usageByModel: [
      { agent: 'codex', runCount: 2, inputTokens: 90_000, outputTokens: 20_000, costUsd: 0.03, credits: 8, reportedCredits: 8, coverage: { tokenRuns: 2, costRuns: 2, creditRuns: 1, totalRuns: 2 }, model: 'gpt-5.1-codex', provider: 'openai', attribution: 'reported' },
      { agent: 'qodercli', runCount: 1, inputTokens: 24_400, outputTokens: 9_600, costUsd: 0.005, credits: 4, reportedCredits: 4, coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 }, model: 'qwen3.8-flash', provider: 'qoder', attribution: 'reported' },
      { agent: 'opencode', runCount: 1, inputTokens: 14_000, outputTokens: 3_000, costUsd: 0.0062, credits: null, reportedCredits: 6, coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 }, model: null, provider: null, attribution: 'unattributed' },
    ],
    notes: ['Token, USD và credit chỉ cộng số liệu agent báo; thiếu dữ liệu được giữ là chưa rõ.'],
  };
}

function tool(agent: DashboardTool['agent'], title: string, check: DashboardTool['lastCheck']): DashboardTool {
  return { agent, title, configuredBin: null, installed: true, lastCheck: check, suggestions: [] };
}

const BASE_CHECK = {
  checkedAt: 1_760_000_050_000,
  status: 'ready' as const,
  version: '1.0.0',
  account: { state: 'authenticated' as const, label: 'fixture@example.com', source: 'cli', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: 'cli', reason: null },
  credits: { remaining: null, unit: null, resetAt: null, source: 'cli', reason: null },
  probes: [],
};

/** Synthetic dashboard state: one tier and multiplier per agent. */
function dashboardFixture(checked: boolean): DashboardSnapshot {
  const tools: DashboardTool[] = [
    tool('codex', 'Codex', checked ? {
      ...BASE_CHECK,
      plan: { name: 'ChatGPT Plus', tier: 'plus', source: 'auth.json' },
      currentModel: { id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
      models: [{ id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', multiplier: 1, source: 'cli' }],
    } : null),
    tool('qodercli', 'Qoder', checked ? {
      ...BASE_CHECK,
      plan: { name: 'Pro Trial', tier: 'trial', source: 'status -o json' },
      currentModel: { id: 'qwen3.8-flash', label: 'Qwen3.8-Flash' },
      models: [{ id: 'qwen3.8-flash', label: 'Qwen3.8-Flash', multiplier: 0, source: 'cli' }],
    } : null),
    tool('agy', 'Antigravity', checked ? {
      ...BASE_CHECK,
      plan: { name: 'Antigravity Pro', tier: 'pro', source: 'usage' },
      currentModel: { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
      models: [{ id: 'gemini-3-pro', label: 'Gemini 3 Pro', multiplier: 0.5, originalMultiplier: 1, promo: 'Đang giảm', source: 'cli' }],
    } : null),
    tool('opencode', 'OpenCode', checked ? {
      ...BASE_CHECK,
      plan: { name: 'BYOK', tier: 'byok', source: 'opencode.json' },
      currentModel: { id: 'tokenharbor/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash 1017' },
      models: [{ id: 'tokenharbor/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash 1017', multiplier: null, contextTokens: 1_000_000, source: 'config' }],
    } : null),
  ];
  return { generatedAt: 1_760_000_050_000, tools, terminalSessions: [] };
}

interface RouteOptions {
  snapshot: ObservabilitySnapshot;
  dashboard: DashboardSnapshot;
  /** When set, `/api/observability` answers 500 until the test flips this flag. */
  failObservability?: { value: boolean };
  /** When set, `/api/observability` waits for this promise before answering. */
  observabilityGate?: Promise<void>;
}

async function openUsage(page: Page, options: RouteOptions): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/observability') {
      if (options.observabilityGate) await options.observabilityGate;
      if (options.failObservability?.value) return route.fulfill({ status: 500, body: 'fixture failure' });
      return route.fulfill({ json: options.snapshot });
    }
    if (url.pathname === '/api/dashboard') return route.fulfill({ json: options.dashboard });
    if (url.pathname === '/api/plans') return route.fulfill({ json: [PLAN] });
    return route.fulfill({ json: [] });
  });
  const dataDir = process.env.FLEET_DATA_DIR!;
  const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
  await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tài nguyên & mức sử dụng', exact: true })).toBeVisible();
}

/** Relative luminance/contrast for computed colors, worst case across matches. */
async function minContrastOf(page: Page, selector: string): Promise<number> {
  const values = await page.locator(selector).evaluateAll((elements) => elements.map((element) => {
    const parse = (value: string): number[] => {
      const parts = (value.match(/[\d.]+/g) ?? []).map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts.length > 3 ? parts[3]! : 1];
    };
    const luminance = (rgb: number[]): number => rgb
      .slice(0, 3)
      .map((channel) => channel / 255)
      .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    // Composite the element's own background over its ancestors so a transparent
    // text node is measured against the surface it actually sits on.
    const layers: number[][] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color[3] === 0) continue;
      layers.push(color);
      if (color[3] === 1) break;
    }
    let background = layers.pop() ?? [255, 255, 255, 1];
    for (let index = layers.length - 1; index >= 0; index--) {
      const [red, green, blue, alpha] = layers[index] as [number, number, number, number];
      background = [red * alpha + background[0]! * (1 - alpha), green * alpha + background[1]! * (1 - alpha), blue * alpha + background[2]! * (1 - alpha), 1];
    }
    const foreground = luminance(parse(getComputedStyle(element).color));
    const behind = luminance(background);
    return (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05);
  }));
  return Math.min(...values);
}

test('empty usage state explains how to get data instead of drawing a flat chart', async ({ page }) => {
  await openUsage(page, { snapshot: emptySnapshot(), dashboard: dashboardFixture(false) });

  await expect(page.locator('.usage-empty')).toContainText('Chưa có số liệu sử dụng');
  const kpis = page.locator('.kpi-tile .kpi-value');
  await expect(kpis).toHaveCount(4);
  for (let index = 0; index < 4; index++) await expect(kpis.nth(index)).toHaveText('Chưa có dữ liệu');

  // Regression: the old page printed "0/0 lần chạy" and a covered-run count of 0.
  await expect(page.locator('.usage-page')).not.toContainText('0/0');
  await expect(page.locator('.usage-page')).not.toContainText('0 lần chạy');

  const charts = page.locator('.usage-chart');
  await expect(charts).toHaveCount(2);
  await expect(page.locator('.chart-empty')).toHaveCount(2);
  await expect(page.locator('svg.resource-chart, .resource-chart polyline')).toHaveCount(0);
  await expect(charts.first()).toContainText('Chưa có mẫu CPU');

  // Tiers are unknown until a manual check, and each row still renders.
  const agentTable = page.locator('table[aria-label="Mức sử dụng theo agent"]');
  await expect(agentTable.locator('tbody tr')).toHaveCount(4);
  await expect(page.locator('.tier-badge')).toHaveCount(0);
  await expect(agentTable).toContainText('Chưa kiểm tra');
});

test('agent table shows tier badges plus credit and multiplier per agent', async ({ page }) => {
  await openUsage(page, { snapshot: dataSnapshot(), dashboard: dashboardFixture(true) });

  const agentTable = page.locator('table[aria-label="Mức sử dụng theo agent"]');
  const row = (agent: string) => agentTable.locator(`tr[data-agent="${agent}"]`);
  await expect(row('codex').locator('.tier-badge')).toHaveText('PLUS');
  await expect(row('qodercli').locator('.tier-badge')).toHaveText('TRIAL');
  await expect(row('agy').locator('.tier-badge')).toHaveText('PRO');
  await expect(row('opencode').locator('.tier-badge')).toHaveText('BYOK');

  await expect(row('codex').locator('.usage-mult')).toHaveText('x1');
  await expect(row('qodercli').locator('.usage-mult')).toHaveText('Miễn phí');
  await expect(row('agy').locator('.usage-mult')).toContainText('x0.5');
  await expect(row('agy').locator('.usage-mult s')).toHaveText('x1');
  await expect(row('agy').locator('.usage-promo')).toHaveText('Đang giảm');
  await expect(row('opencode').locator('.usage-mult')).toHaveCount(0);
  await expect(row('opencode').locator('td').last()).toHaveText('—');

  await expect(row('codex')).toContainText('8');
  await expect(page.locator('table[aria-label="Mức sử dụng theo model"]')).toContainText('Chưa gán được model');
  expect(await minContrastOf(page, '.tier-badge')).toBeGreaterThanOrEqual(3);
});

test('a failed usage request offers a retry that loads the numbers', async ({ page }) => {
  const failObservability = { value: true };
  await openUsage(page, { snapshot: dataSnapshot(), dashboard: dashboardFixture(true), failObservability });

  const banner = page.locator('.usage-error');
  await expect(banner).toContainText('Không tải được số liệu (500)');
  await expect(page.locator('.kpi-tile')).toHaveCount(0);

  failObservability.value = false;
  await banner.getByRole('button', { name: 'Thử lại' }).click();
  await expect(page.locator('.usage-error')).toHaveCount(0);
  await expect(page.locator('.kpi-tile .kpi-value').first()).toHaveText('161.000');
});

test('a slow first read shows a skeleton instead of the empty state', async ({ page }) => {
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await openUsage(page, { snapshot: emptySnapshot(), dashboard: dashboardFixture(false), observabilityGate: gate });

  await expect(page.locator('.usage-loading')).toBeVisible();
  await expect(page.locator('.usage-loading')).toContainText('Đang tải số liệu');
  // Regression: the old page rendered "0/0 lần chạy" and empty tables while loading.
  await expect(page.locator('.usage-page .page-heading')).toBeVisible();
  await expect(page.locator('.usage-page')).not.toContainText('Chưa có số liệu sử dụng');
  await expect(page.locator('.usage-page')).not.toContainText('0/0');
  await expect(page.locator('.kpi-value')).toHaveCount(0);
  await page.screenshot({ path: '.tmp/ui-qa/usage-loading-light.png', fullPage: true, animations: 'disabled' });

  release();
  await expect(page.locator('.usage-empty')).toBeVisible();
  await expect(page.locator('.kpi-value').first()).toHaveText('Chưa có dữ liệu');
});

test('inspector resource chart shows guidance instead of an axis line when nothing was measured', async ({ page }) => {
  await page.route('**/api/observability**', (route) => route.fulfill({ json: emptySnapshot() }));
  const dataDir = process.env.FLEET_DATA_DIR!;
  const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  const repoPath = (await readFile(path.join(dataDir, 'repo-path'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  const plan = await (await page.request.post('/api/plans', { data: { name: 'Inspector empty plan', repoPath } })).json();
  const task = await (await page.request.post('/api/tasks', { data: { planId: plan.id, agent: 'fake', title: 'Inspector empty task', brief: 'T7 inspector smoke' } })).json();
  await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });
  await page.reload();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Inspector empty task/ }).click();

  const chart = page.locator('.inspector .chart-empty.compact');
  await expect(chart).toBeVisible();
  await expect(chart).toContainText('Chưa có mẫu CPU');
  await expect(page.locator('.inspector polyline')).toHaveCount(0);
  await page.screenshot({ path: '.tmp/ui-qa/usage-inspector-empty-light.png', fullPage: true, animations: 'disabled' });
});

for (const state of ['empty', 'data'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`usage ${state} state reads at 375/768/1440 in the ${theme} theme`, async ({ page }) => {
      await openUsage(page, {
        snapshot: state === 'empty' ? emptySnapshot() : dataSnapshot(),
        dashboard: dashboardFixture(state === 'data'),
      });
      await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      for (const width of [375, 768, 1440]) {
        // Tall viewport so the whole page is in the screenshot; the app scrolls
        // inside `.main.standalone`, which fullPage capture cannot reach.
        await page.setViewportSize({ width, height: 2600 });
        await expect.poll(async () => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        await page.screenshot({ path: `.tmp/ui-qa/usage-${state}-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
      }

      // Readability: KPI values and badges must stay above 3:1 in both themes.
      expect(await minContrastOf(page, '.kpi-value')).toBeGreaterThanOrEqual(3);
      if (state === 'data') expect(await minContrastOf(page, '.tier-badge')).toBeGreaterThanOrEqual(3);
    });
  }
}
