import { expect, test } from '@playwright/test';
import { card, dashboardFixture, login, navigate, stubDashboard } from './dashboard-fixture.js';

/** The approved reference replaces the former recommendation strip with an attention panel. */
test('attention panel links low quota and exhausted keys to the corresponding real detail view', async ({ page }) => {
  await stubDashboard(page);
  const checks: string[] = []; const launches: string[] = [];
  page.on('request', request => { if (request.method() !== 'POST') return; if (request.url().includes('/api/dashboard/check')) checks.push(request.url()); if (request.url().includes('/api/terminal-sessions')) launches.push(request.url()); });
  await login(page);
  const attention = page.locator('.dashboard-page .panel').filter({ has: page.locator('.attn') });
  await expect(attention).toContainText('Cần chú ý');
  await expect(attention.locator('.attn li')).toHaveCount(3);
  await expect(attention.locator('.attn li').first()).toContainText('Codex');
  await attention.locator('.attn li').first().getByRole('button', { name: 'Mở', exact: true }).click();
  await expect(page.locator('.tool-page').getByRole('heading', { name: 'Codex', exact: true })).toBeVisible();
  expect(checks).toEqual([]); expect(launches).toEqual([]);
});

test('health markers agree on dashboard, compare, resources and tool details', async ({ page }) => {
  await stubDashboard(page); await login(page);
  const headerDot = card(page, 'opencode').locator('.card-top .dot');
  await expect(headerDot).toHaveClass(/warn/);
  await expect(headerDot).toHaveAttribute('aria-label', /key cạn/);
  await navigate(page, 'So sánh agent');
  await expect(page.locator('.compare-page article[data-tool="opencode"] .card-top .dot')).toHaveClass(/warn/);
  await navigate(page, 'Tài nguyên & sử dụng');
  await expect(page.getByRole('table', { name: 'Mức sử dụng theo agent' }).getByRole('row').filter({ hasText: 'OpenCode' }).locator('.badge')).toHaveClass(/warn/);
});

test('unchecked or healthy tools do not invent attention warnings and never trigger automatic checks', async ({ page }) => {
  const snapshot = dashboardFixture();
  const checks: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/dashboard/check')) checks.push(request.url()); });
  snapshot.tools = snapshot.tools.map(tool => ({ ...tool, lastCheck: null }));
  await stubDashboard(page, snapshot); await login(page);
  await expect(page.locator('.dashboard-page .attn li')).toHaveCount(0);
  await expect(page.locator('.dashboard-page')).toContainText('Chưa có cảnh báo trong lần kiểm tra gần nhất.');
  await expect(page.locator('.dashboard-page .card-top .dot.plain')).toHaveCount(4);
  snapshot.tools = dashboardFixture().tools.map(tool => ({ ...tool, lastCheck: { ...tool.lastCheck!, quotaWindows: tool.lastCheck!.quotaWindows?.map(row => ({ ...row, remainingPct: 80 })), keyPools: tool.lastCheck!.keyPools?.map(pool => ({ ...pool, exhausted: 0 })) } }));
  await page.reload();
  await expect(page.locator('.dashboard-page .attn li')).toHaveCount(0);
  await expect(page.locator('.dashboard-page .card-top .dot')).toHaveCount(4);
  await expect(page.locator('.dashboard-page .card-top .dot.warn, .dashboard-page .card-top .dot.bad, .dashboard-page .card-top .dot.plain')).toHaveCount(0);
  expect(checks).toEqual([]);
});
