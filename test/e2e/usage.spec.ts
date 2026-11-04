import { expect, test, type Page } from '@playwright/test';
import type { DashboardSnapshot } from '../../shared/dashboard.js';
import type { ObservabilitySnapshot } from '../../shared/observability.js';
import { dashboardFixture, login, navigate, stubDashboard, USAGE_PLAN, usageRuns, usageSnapshot } from './dashboard-fixture.js';
import { setTheme } from './nav-helpers.js';

interface UsageOptions { populated?: boolean; dashboard?: DashboardSnapshot; failed?: { value: boolean }; gate?: Promise<void>; snapshot?: ObservabilitySnapshot; }
async function openUsage(page: Page, options: UsageOptions = {}) {
  const populated = options.populated ?? true;
  await stubDashboard(page, options.dashboard ?? dashboardFixture());
  const fixture = usageRuns();
  await page.route('**/api/plans', route => route.fulfill({ json: [USAGE_PLAN] }));
  await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: populated ? fixture.tasks : [] }));
  await page.route(/\/api\/tasks\/[^/]+\/runs$/, route => { const id = new URL(route.request().url()).pathname.split('/')[3]; return route.fulfill({ json: fixture.runs[id] ?? [] }); });
  await page.route(/\/api\/observability(?:\?.*)?$/, async route => {
    if (options.gate) await options.gate;
    if (options.failed?.value) return route.fulfill({ status: 500, json: { message: 'Synthetic usage unavailable' } });
    return route.fulfill({ json: options.snapshot ?? usageSnapshot(populated) });
  });
  await page.route(/\/api\/stats(?:\?.*)?$/, route => {
    if (options.failed?.value) return route.fulfill({ status: 500, json: { message: 'Synthetic stats unavailable' } });
    const days = Number(new URL(route.request().url()).searchParams.get('sinceDays'));
    return route.fulfill({ json: populated ? [{ agent: 'codex', runs: days === 30 ? 4 : 2, successRate: 1, avgDurationMs: days === 30 ? 2500 : 1000, retryRate: 0, mergeRate: 1, costUsd: null }] : [] });
  });
  await login(page); await navigate(page, 'Tài nguyên & sử dụng');
}

test('empty usage explains how to populate the report and draws no flat token line', async ({ page }) => {
  const snapshot = dashboardFixture(); snapshot.tools.forEach(tool => { tool.lastCheck = null; });
  await openUsage(page, { populated: false, dashboard: snapshot });
  const usage = page.locator('.resources-page');
  await expect(usage.locator('.chartpanel .chart-empty')).toContainText('Chưa có token trong khoảng ngày này');
  await expect(usage.getByRole('img', { name: 'Token do CLI báo cáo' })).toHaveCount(0);
  await expect(usage.locator('.kpis .panel').first().locator('.kpi b')).toHaveText('—');
  await expect(usage.getByRole('table', { name: 'Mức sử dụng theo agent' }).locator('tbody tr')).toHaveCount(4);
  await expect(usage.getByRole('table', { name: 'Mức sử dụng theo agent' }).locator('.badge')).toHaveText(['Chưa kiểm tra', 'Chưa kiểm tra', 'Chưa kiểm tra', 'Chưa kiểm tra']);
  await usage.locator('.diagnostics > summary').click();
  await expect(usage.locator('.diagnostics .chart-empty.cpu')).toContainText('Chưa có mẫu CPU');
  await expect(usage.locator('.diagnostics .chart-empty.memory')).toContainText('Chưa có mẫu bộ nhớ');
});

test('usage time range filters recorded run tokens and stats but preserves current plan credits', async ({ page }) => {
  const requestedDays: string[] = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/stats') requestedDays.push(new URL(request.url()).searchParams.get('sinceDays') ?? ''); });
  await openUsage(page);
  const usage = page.locator('.resources-page');
  const tokenKpi = usage.locator('.kpis .panel').nth(0).locator('.kpi b');
  const creditKpi = usage.locator('.kpis .panel').nth(1).locator('.kpi');
  await expect(tokenKpi).toHaveText('2K');
  await expect(usage.locator('.kpis .panel').nth(2).locator('.kpi b')).toHaveText('2');
  await expect(creditKpi).toContainText('1.240');
  await expect(creditKpi).not.toContainText('2.000');
  await expect(usage.getByRole('img', { name: 'Token do CLI báo cáo' })).toBeVisible();
  await expect(usage.locator('.chart .bar-rect')).toHaveCount(7);
  await usage.getByRole('button', { name: '30 ngày', exact: true }).click();
  await expect(tokenKpi).toHaveText('6K');
  await expect(usage.locator('.kpis .panel').nth(2).locator('.kpi b')).toHaveText('4');
  await expect(usage.locator('.chart .bar-rect')).toHaveCount(4);
  await expect(creditKpi).toContainText('1.240');
  expect(requestedDays).toContain('7'); expect(requestedDays).toContain('30');
});

test('agent usage table keeps tiers, free and unknown multipliers, reported credits and token gaps distinct', async ({ page }) => {
  const dashboard = dashboardFixture();
  dashboard.tools[1].lastCheck!.currentModel = { id: dashboard.tools[1].lastCheck!.models![0].id, label: dashboard.tools[1].lastCheck!.models![0].label };
  await openUsage(page, { dashboard });
  const table = page.getByRole('table', { name: 'Mức sử dụng theo agent' });
  const qoder = table.getByRole('row').filter({ hasText: 'Qoder' });
  const opencode = table.getByRole('row').filter({ hasText: 'OpenCode' });
  await expect(qoder).toContainText('PRO TRIAL');
  await expect(qoder).toContainText('MIỄN PHÍ');
  await expect(qoder).toContainText('1.240');
  await expect(qoder.locator('td').nth(5)).toHaveText('—');
  await expect(opencode.locator('td').nth(4)).toHaveText('—');
  await expect(table).not.toContainText('undefined');
  await expect(table).not.toContainText('NaN');
});

test('usage diagnostics preserve reported/configured and unattributed model buckets and export the actual snapshot', async ({ page }) => {
  const snapshot = usageSnapshot();
  await openUsage(page, { snapshot });
  await page.locator('.resources-page .diagnostics > summary').click();
  const models = page.getByRole('table', { name: 'Mức sử dụng theo model' });
  await expect(models).toContainText('gpt-fixture');
  await expect(models).toContainText('qfmodel');
  await expect(models).toContainText('Chưa gán được model');
  await expect(models).toContainText('reported');
  await expect(models).toContainText('configured');
  await expect(models.locator('tbody tr')).toHaveCount(3);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toMatch(/\.json$/);
  const stream = await file.createReadStream(); if (!stream) throw new Error('Missing exported report stream');
  let text = ''; for await (const chunk of stream) text += chunk.toString();
  const report = JSON.parse(text);
  expect(report.usageByModel).toEqual(snapshot.usageByModel);
  expect(report.sampledAt).toBe(snapshot.sampledAt);
  expect(text).not.toMatch(/eyJ|sk-[A-Za-z0-9]/);
});

test('a failed report read offers retry and refreshes both usage and statistics', async ({ page }) => {
  const failed = { value: true };
  await openUsage(page, { failed });
  const error = page.locator('.resources-page .notice.error');
  await expect(error).toHaveAttribute('role', 'alert');
  await expect(error.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
  failed.value = false;
  await error.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(error).toHaveCount(0);
  await expect(page.locator('.resources-page .kpis .panel').nth(2).locator('.kpi b')).toHaveText('2');
});

test('a delayed first report remains loading until data arrives rather than claiming an empty report', async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await openUsage(page, { gate, populated: false });
  await expect(page.locator('.resources-page .chartpanel .chart-empty')).toHaveText('Đang tải mức sử dụng…');
  await expect(page.locator('.resources-page')).not.toContainText('Chưa có token trong khoảng ngày này');
  await expect(page.getByRole('button', { name: 'Xuất báo cáo', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('.resources-page .chartpanel .chart-empty')).toContainText('Chưa có token trong khoảng ngày này');
  await expect(page.getByRole('button', { name: 'Xuất báo cáo', exact: true })).toBeEnabled();
});

for (const theme of ['light', 'dark'] as const) {
  test(`usage empty and populated reports fit phone/tablet/desktop in ${theme}`, async ({ page }) => {
    for (const populated of [false, true]) {
    await openUsage(page, { populated }); await setTheme(page, theme);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.locator('.resources-page').evaluate(el => ({ document: document.documentElement.scrollWidth, viewport: innerWidth, client: el.clientWidth, scroll: el.scrollWidth }));
      expect(layout.document, JSON.stringify(layout)).toBeLessThanOrEqual(width);
      expect(layout.scroll, JSON.stringify(layout)).toBeLessThanOrEqual(layout.client + 1);
      await expect(page.getByRole('table', { name: 'Mức sử dụng theo agent' })).toBeVisible();
    }
    }
  });
}
