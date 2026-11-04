import { expect, test } from '@playwright/test';
import type { DashboardSnapshot } from '../../shared/dashboard.js';
import { card, dashboardFixture, login, savedChecks, stubDashboard } from './dashboard-fixture.js';
import { setTheme } from './nav-helpers.js';

test('authenticated dashboard reads the saved structured cache without starting CLI probes', async ({ page }) => {
  const checks: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/dashboard/check')) checks.push(request.url()); });
  await login(page);
  const response = await page.request.get('/api/dashboard');
  expect(response.status()).toBe(200);
  const raw = await response.text();
  expect(raw).not.toMatch(/eyJ|sk-[A-Za-z0-9]/);
  const snapshot = JSON.parse(raw) as DashboardSnapshot;
  expect(snapshot.tools.map(tool => tool.agent)).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
  for (const tool of snapshot.tools) {
    expect(tool.installed).toBe(false);
    expect(tool.configuredBin).toBeNull();
    expect(tool.lastCheck).toEqual(savedChecks.checks[tool.agent]);
  }
  expect(snapshot.tools[0].lastCheck?.quotaWindows?.map(row => row.remainingPct)).toEqual([22, 34]);
  expect(snapshot.tools[1].lastCheck?.models).toHaveLength(8);
  expect(snapshot.tools[2].lastCheck?.quotaWindows).toHaveLength(6);
  expect(snapshot.tools[3].lastCheck?.keyPools?.[1].remainingPct).toBeNull();
  await expect(card(page, 'codex').locator('.tier')).toHaveText('PLUS');
  await expect(card(page, 'codex').getByRole('img', { name: '5 giờ: 22%', exact: true })).toBeVisible();
  await expect(card(page, 'codex').getByRole('img', { name: 'Tuần: 34%', exact: true })).toBeVisible();
  await expect(card(page, 'agy').getByRole('table', { name: 'Hạn mức theo model' })).toBeVisible();
  expect(checks).toEqual([]);
});

test('slow first dashboard read shows placeholders until the real cards arrive', async ({ page }) => {
  await stubDashboard(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dashboard', async route => { await gate; await route.fulfill({ json: dashboardFixture() }); });
  await login(page);
  await expect(page.locator('.dashboard-page .skeleton-card')).toHaveCount(4);
  await expect(page.locator('.dashboard-page [data-tool]')).toHaveCount(0);
  release();
  await expect(page.locator('.dashboard-page [data-tool]')).toHaveCount(4);
  await expect(page.locator('.dashboard-page .skeleton-card')).toHaveCount(0);
});

for (const theme of ['light', 'dark'] as const) {
  test(`dashboard rings and cards fit 375/768/1440 in ${theme}`, async ({ page }) => {
    await stubDashboard(page); await login(page); await setTheme(page, theme);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const metrics = await page.locator('.dashboard-page').evaluate(root => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, width: root.clientWidth, scroll: root.scrollWidth, columns: getComputedStyle(root.querySelector('.zones')!).gridTemplateColumns.split(' ').length }));
      expect(metrics.document, JSON.stringify(metrics)).toBeLessThanOrEqual(width);
      expect(metrics.scroll, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.width + 1);
      expect(metrics.columns).toBe(width === 1440 ? 4 : width === 768 ? 2 : 1);
      const rings = await page.locator('.dashboard-page .donut .val').evaluateAll(values => values.map(value => ({ cap: getComputedStyle(value).strokeLinecap, radius: value.getAttribute('r'), dash: value.getAttribute('pathLength') })));
      expect(rings.length).toBeGreaterThan(0);
      expect(rings.every(ring => ring.cap === 'butt' && ring.radius === '15' && ring.dash === '100')).toBe(true);
    }
  });
}

test('legacy checks without structured models remain readable and do not fabricate quota', async ({ page }) => {
  const snapshot = dashboardFixture();
  snapshot.tools = [snapshot.tools[0]];
  snapshot.tools[0].lastCheck = { ...snapshot.tools[0].lastCheck!, quotaWindows: undefined, models: undefined, currentModel: undefined, plan: undefined, quota: { remaining: null, unit: null, source: 'fixture', resetAt: null, reason: 'CLI chưa cung cấp hạn mức.' } };
  await stubDashboard(page, snapshot); await login(page);
  const codex = card(page, 'codex');
  await expect(codex).toContainText('CLI chưa cung cấp hạn mức.');
  await expect(codex.locator('.donut')).toHaveCount(0);
  await expect(codex).not.toContainText('0%');
  await expect(codex).not.toContainText('undefined');
});
