import { mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { DashboardCheck, DashboardSnapshot } from '../../shared/dashboard.js';
import type { ObservabilitySnapshot, ResourceSample } from '../../shared/observability.js';
import type { Plan, Task, TaskResult } from '../../shared/types.js';
import { setTheme } from './nav-helpers.js';

/**
 * T8 — E2E cho Dashboard v3 và trang Tài nguyên & sử dụng.
 *
 * `test/e2e/global-setup.ts` chép `fixtures/dashboard-checks.json` vào
 * `<FLEET_DATA_DIR>/dashboard-checks.json` **trước khi** server khởi động, nên
 * Dashboard đọc dữ liệu qua `GET /api/dashboard` thật đã xác thực và cache
 * `version: 1` của server, không mock toàn bộ API. Trang Tài nguyên dùng
 * snapshot tổng hợp ghim theo route: bản "có dữ liệu" và bản "trống" đều cố
 * định, không đọc lịch sử chạy dùng chung (test độc lập thứ tự). Toàn bộ số
 * liệu là tổng hợp; agent bị tắt trong `global-setup` nên không CLI nào chạy.
 */

const shotDir = path.join('docs', 'images', '2.3');
mkdirSync(shotDir, { recursive: true });

const fixture = JSON.parse(readFileSync(
  path.join('test', 'e2e', 'fixtures', 'dashboard-checks.json'),
  'utf8',
)) as { version: number; checks: Record<string, DashboardCheck> };

async function login(page: Page): Promise<void> {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
}

interface LayoutReport {
  documentWidth: number;
  viewport: number;
  containerScroll: number;
  containerClient: number;
  offenders: string[];
  columns: number;
}

/**
 * Đo layout thật trong browser (không đọc CSS): bề rộng tài liệu, vùng cuộn của
 * trang và mọi phần tử thò ra ngoài khung. Ảnh chỉ được chụp khi các số này đạt.
 */
async function layoutReport(page: Page, container: string, root: string): Promise<LayoutReport> {
  return page.evaluate(({ containerSelector, rootSelector }) => {
    const host = document.querySelector<HTMLElement>(containerSelector);
    const limit = host ? host.clientWidth : window.innerWidth;
    const right = host ? host.getBoundingClientRect().right : window.innerWidth;
    const label = (element: Element): string => {
      const box = element.getBoundingClientRect();
      const className = element.getAttribute('class')?.trim().split(/\s+/).join('.');
      return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''}:${Math.round(box.width)}px`;
    };
    const offenders = [...document.querySelectorAll(`${rootSelector} *`)]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > limit + 1 || box.right > right + 1;
      })
      .slice(0, 6)
      .map(label);
    const grid = document.querySelector('.dash-grid');
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      containerScroll: host?.scrollWidth ?? 0,
      containerClient: host?.clientWidth ?? 0,
      offenders,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length : 0,
    };
  }, { containerSelector: container, rootSelector: root });
}

function expectFitsInside(report: LayoutReport, width: number): void {
  const detail = JSON.stringify(report);
  expect(report.viewport, detail).toBe(width);
  // Lỗi cuộn ngang của cả tài liệu (playbook mục 2).
  expect(report.documentWidth, detail).toBeLessThanOrEqual(report.viewport);
  // Và của đúng vùng cuộn; `overflow-y:auto` biến trục X thành auto nên phải khớp.
  expect(report.containerScroll, detail).toBeLessThanOrEqual(report.containerClient);
  // Không có phần tử nào rộng hơn khung hoặc thò ra ngoài mép phải.
  expect(report.offenders, detail).toEqual([]);
}

/**
 * Chụp toàn bộ nội dung: các trang này cuộn bên trong một vùng cố định, nên
 * `fullPage` chỉ chụp đúng viewport. Nới chiều cao viewport bằng chiều cao nội
 * dung thật để ảnh không bị cắt (không ẩn overflow để né lỗi).
 */
async function capture(page: Page, file: string, scroller: string, width: number): Promise<void> {
  const needed = await page.evaluate(
    (selector) => document.querySelector<HTMLElement>(selector)?.scrollHeight ?? document.documentElement.scrollHeight,
    scroller,
  );
  await page.setViewportSize({ width, height: Math.min(8_000, Math.max(1_200, needed + 160)) });
  const report = await layoutReport(page, scroller, scroller === '.dashboard-host' ? '.dashboard-page' : '.usage-page');
  expectFitsInside(report, width);
  await page.screenshot({ path: path.join(shotDir, file), fullPage: true, animations: 'disabled' });
}

// ── dữ liệu tổng hợp cho trang Tài nguyên ───────────────────────────────────
function sample(index: number): ResourceSample {
  const memory = (360 + index * 7) * 1024 ** 2;
  return {
    sampledAt: 1_793_706_000_000 + index * 5_000,
    scope: 'server-only',
    cpuPercent: 6 + ((index * 13) % 48),
    memoryBytes: memory,
    peakMemoryBytes: memory + 32 * 1024 ** 2,
    cpuTimeMs: 1_000 + index * 250,
    processCount: 3,
    gpu: null,
  };
}

/** Snapshot có số liệu cho mọi khối; chỉ dùng làm route stub, không đọc máy thật. */
function populatedObservability(): ObservabilitySnapshot {
  const history = Array.from({ length: 12 }, (_, index) => sample(index));
  const coverage = { tokenRuns: 3, costRuns: 2, creditRuns: 2, totalRuns: 4 };
  const metrics = {
    runCount: 2, inputTokens: 90_000, outputTokens: 20_000, costUsd: 0.03, credits: 8, reportedCredits: 8,
    coverage: { tokenRuns: 2, costRuns: 2, creditRuns: 1, totalRuns: 2 },
  };
  return {
    sampledAt: 1_793_706_100_000,
    app: { version: '2.3.0', platform: 'win32', nodeVersion: '24.0.0', uptimeMs: 3_600_000, desktop: false },
    resource: history.at(-1)!,
    history,
    system: { totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 20 * 1024 ** 3, logicalCpuCount: 16 },
    usage: {
      planId: null, taskCount: 3, runCount: 4, completedRuns: 3,
      inputTokens: 128_400, outputTokens: 32_600, costUsd: 0.0412, credits: 12, reportedCredits: 18,
      coverage,
      resources: { measuredRuns: 3, peakMemoryBytes: 1.5 * 1024 ** 3, observedCpuTimeMs: 125_000 },
    },
    plans: [],
    runs: [],
    activeJobs: [],
    usageByTool: [
      { agent: 'codex', ...metrics, models: [{ name: 'gpt-5.1-codex', provider: 'openai', source: 'reported', generic: false }] },
      {
        agent: 'qodercli', runCount: 1, inputTokens: 24_400, outputTokens: 9_600, costUsd: 0.005, credits: 4, reportedCredits: 4,
        coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 },
        models: [{ name: 'qwen3.8-flash', provider: 'qoder', source: 'reported', generic: false }],
      },
      {
        agent: 'opencode', runCount: 1, inputTokens: 14_000, outputTokens: 3_000, costUsd: 0.0062, credits: null, reportedCredits: 6,
        coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 },
        models: [{ name: 'tokenharbor/deepseek-v4.1-flash-1017', provider: 'tokenharbor', source: 'reported', generic: false }],
      },
    ],
    usageByModel: [
      { agent: 'codex', ...metrics, model: 'gpt-5.1-codex', provider: 'openai', attribution: 'reported' },
      {
        agent: 'qodercli', runCount: 1, inputTokens: 24_400, outputTokens: 9_600, costUsd: 0.005, credits: 4, reportedCredits: 4,
        coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 },
        model: 'qwen3.8-flash', provider: 'qoder', attribution: 'reported',
      },
      {
        agent: 'opencode', runCount: 1, inputTokens: 14_000, outputTokens: 3_000, costUsd: 0.0062, credits: null, reportedCredits: 6,
        coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 },
        model: null, provider: null, attribution: 'unattributed',
      },
    ],
    notes: ['Fixture E2E tổng hợp: token, USD và credit chỉ cộng số liệu agent báo; thiếu dữ liệu được giữ là chưa rõ.'],
  };
}

/**
 * Snapshot **rỗng** tổng hợp: không có lần chạy nào. Trạng thái trống không được
 * đọc từ server thật, vì lịch sử chạy dùng chung của bộ E2E thay đổi theo thứ tự
 * test (ví dụ `ui.spec.ts` tạo một task fake-agent). Ghim route này giữ test độc
 * lập thứ tự mà không xoá dữ liệu của test khác.
 */
function emptyObservability(): ObservabilitySnapshot {
  return {
    sampledAt: 1_793_706_200_000,
    app: { version: '2.3.0', platform: 'win32', nodeVersion: '24.0.0', uptimeMs: 120_000, desktop: false },
    resource: sample(0),
    history: [],
    system: { totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 16 * 1024 ** 3, logicalCpuCount: 16 },
    usage: {
      planId: null, taskCount: 0, runCount: 0, completedRuns: 0,
      inputTokens: null, outputTokens: null, costUsd: null, credits: null, reportedCredits: null,
      coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 0 },
      resources: { measuredRuns: 0, peakMemoryBytes: null, observedCpuTimeMs: null },
    },
    plans: [],
    runs: [],
    activeJobs: [],
    usageByTool: [],
    usageByModel: [],
    notes: ['Fixture E2E tổng hợp: trạng thái trống không có lần chạy nào.'],
  };
}

/**
 * Ghim `/api/observability` vào snapshot rỗng tổng hợp; `/api/dashboard` vẫn là
 * GET thật đã xác thực nên badge tier vẫn đi qua cache `version: 1` của server.
 * Trả về hàm đếm số lần route đã phục vụ để test chứng minh trang đọc fixture.
 */
async function stubEmptyObservability(page: Page): Promise<() => number> {
  let calls = 0;
  await page.route('**/api/observability**', (route) => {
    calls += 1;
    return route.fulfill({ json: emptyObservability() });
  });
  return () => calls;
}

// ── cache thật của server ───────────────────────────────────────────────────
test('GET /api/dashboard thật đọc cache version:1 và giữ nguyên trường có cấu trúc', async ({ page }) => {
  const checks: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/dashboard/check')) checks.push(request.url());
  });
  await login(page);

  const response = await page.request.get('/api/dashboard');
  expect(response.status()).toBe(200);
  const raw = await response.text();
  // Cache được chép từ fixture tổng hợp; không bao giờ chứa token/khóa.
  expect(raw).not.toMatch(/eyJ|sk-[A-Za-z0-9]/);
  expect(fixture.version).toBe(1);

  const snapshot = JSON.parse(raw) as DashboardSnapshot;
  expect(snapshot.tools.map((tool) => tool.agent)).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
  expect(snapshot.terminalSessions).toEqual([]);
  for (const tool of snapshot.tools) {
    // Agent bị tắt trong E2E: server không bao giờ dò CLI, nhưng check đã lưu vẫn còn.
    expect(tool.installed, tool.agent).toBe(false);
    expect(tool.configuredBin, tool.agent).toBeNull();
    expect(tool.lastCheck, tool.agent).toEqual(fixture.checks[tool.agent]);
  }

  // Các trường v3 phải sống sót qua `parseCachedCheck` + JSON, không chỉ chuỗi details.
  const check = (agent: string): DashboardCheck => snapshot.tools.find((tool) => tool.agent === agent)!.lastCheck!;
  expect(check('codex').plan).toEqual({ name: 'ChatGPT Plus', tier: 'plus', renewsAt: '2026-12-01T00:00:00Z', source: 'auth.json' });
  expect(check('codex').currentModel).toEqual({ id: 'gpt-5.1-codex', label: 'GPT-5.1 Codex', effort: 'high' });
  expect(check('codex').quotaWindows?.map((window) => window.remainingPct)).toEqual([22, 34]);
  expect(check('qodercli').models).toHaveLength(8);
  expect(check('qodercli').models?.[0]).toMatchObject({ multiplier: 0, promo: 'Đang giảm', contextTokens: 1_000_000, source: 'pty' });
  expect(check('agy').quotaWindows).toHaveLength(6);
  expect(check('agy').credits.remaining).toBe(850);
  expect(check('opencode').keyPools?.[0]?.keys[0]?.label).toBe('...ALPHA');
  // Pool tắt là `null`, không phải 0%.
  expect(check('opencode').keyPools?.[1]?.remainingPct).toBeNull();
  expect(check('opencode').highlights?.[0]).toContain('không phải 0%');

  // Cùng dữ liệu đó phải hiện trên UI, và GET không được tự chạy probe.
  const codex = page.locator('.tool-card', { hasText: 'Codex' });
  await expect(codex).toContainText('ChatGPT Plus');
  await expect(codex.locator('.tier-badge')).toHaveText('PLUS');
  await expect(codex.locator('.dash-meter[data-group="Codex"] .dash-bar')).toHaveAttribute('aria-valuenow', '22');
  await expect(page.locator('.dashboard-page')).toContainText('Kiểm tra lúc');
  await expect(page.locator('.dash-picks button.dash-pick')).toHaveCount(3);
  await expect(page.locator('.dash-picks .dash-pick.is-warn')).toHaveCount(1);
  expect(checks).toEqual([]);
});

// ── Dashboard: 3 độ rộng × 2 theme ──────────────────────────────────────────
for (const theme of ['light', 'dark'] as const) {
  test(`dashboard v3 đọc được ở 375/768/1440 theme ${theme}, không tràn ngang`, async ({ page }) => {
    await login(page);
    await setTheme(page, theme);

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1_000 });
      const report = await layoutReport(page, '.dashboard-host', '.dashboard-page');
      expectFitsInside(report, width);
      // 375 px xếp một cột; 1440 px hai cột như mockup.
      expect(report.columns, JSON.stringify(report)).toBe(width === 1440 ? 2 : 1);
      await capture(page, `dashboard-${width}-${theme}.png`, '.dashboard-host', width);
    }
  });
}

// ── Tài nguyên & sử dụng: trạng thái trống và có dữ liệu (cả hai tổng hợp) ──
for (const theme of ['light', 'dark'] as const) {
  test(`tài nguyên trống đọc được ở 375/768/1440 theme ${theme}`, async ({ page }) => {
    // Snapshot rỗng tổng hợp, ghim trước khi trang tải: kết quả không phụ thuộc
    // lịch sử chạy dùng chung của server nên test đúng với mọi thứ tự. Badge tier
    // bên dưới vẫn đọc `/api/dashboard` thật để giữ điểm nối cache.
    const observabilityReads = await stubEmptyObservability(page);
    await login(page);
    await expect(page.locator('.dash-picks button.dash-pick')).toHaveCount(3);
    await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Tài nguyên & mức sử dụng', exact: true })).toBeVisible();
    await expect(page.locator('.usage-empty')).toContainText('Chưa có số liệu sử dụng');
    await expect(page.locator('.kpi-tile .kpi-value')).toHaveCount(4);
    for (const value of await page.locator('.kpi-tile .kpi-value').allInnerTexts()) expect(value).toBe('Chưa có dữ liệu');
    await expect(page.locator('.usage-page')).not.toContainText('0/0');
    // Dù chưa có lần chạy, tier vẫn hiện từ cache dashboard thật (không mock).
    const agentTable = page.locator('table[aria-label="Mức sử dụng theo agent"]');
    await expect(agentTable.locator('tr[data-agent="codex"] .tier-badge')).toHaveText('PLUS');
    await expect(agentTable.locator('tr[data-agent="qodercli"] .tier-badge')).toHaveText('TRIAL');
    await expect(agentTable.locator('tr[data-agent="agy"] .tier-badge')).toHaveText('PRO');
    await expect(agentTable.locator('tr[data-agent="opencode"] .tier-badge')).toHaveText('BYOK');
    expect(observabilityReads()).toBeGreaterThan(0);
    await setTheme(page, theme);

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1_000 });
      expectFitsInside(await layoutReport(page, '.main.standalone', '.usage-page'), width);
      await capture(page, `usage-empty-${width}-${theme}.png`, '.main.standalone', width);
    }
  });

  test(`tài nguyên có dữ liệu đọc được ở 375/768/1440 theme ${theme}`, async ({ page }) => {
    await page.route('**/api/observability**', (route) => route.fulfill({ json: populatedObservability() }));
    await login(page);
    await expect(page.locator('.dash-picks button.dash-pick')).toHaveCount(3);
    await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
    await expect(page.locator('.kpi-tile .kpi-value').first()).toHaveText('161.000');
    await expect(page.locator('.usage-page')).not.toContainText('Chưa có số liệu sử dụng');

    // Badge tier lấy từ cache dashboard thật, không mock: đây là điểm nối giữa
    // `/api/dashboard` và bảng theo agent của trang Tài nguyên.
    const agentTable = page.locator('table[aria-label="Mức sử dụng theo agent"]');
    await expect(agentTable.locator('tr[data-agent="codex"] .tier-badge')).toHaveText('PLUS');
    await expect(agentTable.locator('tr[data-agent="qodercli"] .tier-badge')).toHaveText('TRIAL');
    await expect(agentTable.locator('tr[data-agent="agy"] .tier-badge')).toHaveText('PRO');
    await expect(agentTable.locator('tr[data-agent="opencode"] .tier-badge')).toHaveText('BYOK');
    await setTheme(page, theme);

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1_000 });
      expectFitsInside(await layoutReport(page, '.main.standalone', '.usage-page'), width);
      await capture(page, `usage-populated-${width}-${theme}.png`, '.main.standalone', width);
    }
  });
}

// ── Hồi quy: trạng thái trống không phụ thuộc lịch sử chạy của server ───────
/**
 * Lỗi thật đã tái hiện (leader, 2026-11-04): hai test "tài nguyên trống" đọc
 * `/api/observability` thật nên chỉ pass khi chưa có task fake-agent nào chạy;
 * chạy sau `ui.spec.ts` thì fail. Test này tự tạo một lần chạy thật rồi chứng
 * minh fixture rỗng vẫn cho trạng thái trống, tức là độc lập thứ tự và không
 * xoá dữ liệu của test khác.
 */
test('trạng thái trống tổng hợp vẫn trống dù server đã có lần chạy fake-agent', async ({ page }) => {
  await login(page);
  const dataDir = process.env.FLEET_DATA_DIR!;
  const repoPath = (await readFile(path.join(dataDir, 'repo-path'), 'utf8')).trim();
  const plan = await (await page.request.post('/api/plans', {
    data: { name: 'T8 empty fixture isolation', repoPath },
  })).json() as Plan;
  const task = await (await page.request.post('/api/tasks', {
    data: { planId: plan.id, agent: 'fake', title: 'T8 empty fixture isolation', brief: 'synthetic empty-state regression' },
  })).json() as Task;
  const waited = await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });
  expect(waited.ok()).toBeTruthy();
  const results = await waited.json() as TaskResult[];
  expect(results[0]?.task.status).toBe('done');

  // Server thật đã có lịch sử chạy: đây là điều kiện từng làm test trống fail.
  const realResponse = await page.request.get('/api/observability');
  expect(realResponse.status()).toBe(200);
  const real = await realResponse.json() as ObservabilitySnapshot;
  expect(real.usage.runCount).toBeGreaterThan(0);
  expect(real.usageByTool.some((row) => row.agent === 'fake')).toBe(true);

  // Fixture rỗng không đọc lịch sử đó, nên trạng thái trống vẫn đúng.
  const observabilityReads = await stubEmptyObservability(page);
  await page.reload();
  await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
  await expect(page.locator('.usage-empty')).toContainText('Chưa có số liệu sử dụng');
  await expect(page.locator('.usage-page')).not.toContainText('fake');
  for (const value of await page.locator('.kpi-tile .kpi-value').allInnerTexts()) expect(value).toBe('Chưa có dữ liệu');
  await expect(page.locator('.usage-page')).not.toContainText('0/0');
  expect(observabilityReads()).toBeGreaterThan(0);
});
