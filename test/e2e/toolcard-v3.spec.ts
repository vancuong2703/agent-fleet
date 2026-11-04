import { expect, test } from '@playwright/test';
import { card, dashboardFixture, login, openTool, stubDashboard } from './dashboard-fixture.js';

test('tool cards and their dedicated detail pages preserve quotas, credit totals, models and masked pools', async ({ page }) => {
  await stubDashboard(page); await login(page);
  const snapshot = dashboardFixture();
  const qoder = card(page, 'qodercli');
  await expect(qoder.locator('.credit')).toContainText('1.240');
  // Two credit sources are aggregated; never divide their total by one source's cap.
  await expect(qoder.locator('.credit')).not.toContainText('2.000');
  await expect(qoder.locator('.models .m')).toHaveCount(2);
  await expect(qoder.locator('.models .m').first()).toContainText('Qwen3.8-Flash');
  await openTool(page, 'qodercli');
  await expect(page.locator('.tool-page')).toContainText('Pro Trial');
  await expect(page.locator('.tool-page .models .m')).toHaveCount(snapshot.tools[1].lastCheck!.models!.length);
  const labels = await page.locator('.tool-page .models .mn').allInnerTexts();
  expect(labels.slice(0, 3)).toEqual(['Qwen3.8-Flash', 'DeepSeek-Flash', 'GLM-5.3-Flash']);
  await expect(page.locator('.tool-page .models .mult.free')).toHaveCount(1);
  await expect(page.locator('.tool-page .models .m').first()).toContainText('Đang giảm');
  await expect(page.locator('.tool-page .models .m').first().locator('s')).toHaveText('x0.1');
  await expect(page.locator('.tool-page')).toContainText('Credit bổ sung');
  await page.locator('.tool-page').getByRole('button', { name: 'Bảng điều khiển', exact: false }).click();
  await openTool(page, 'opencode');
  await expect(page.locator('.tool-page .key-grid .badge')).toHaveCount(13);
  await expect(page.locator('.tool-page .key-grid .badge.bad')).toHaveCount(1);
  await expect(page.locator('.tool-page')).toContainText('pool không chạy');
  await expect(page.locator('.tool-page')).not.toContainText('sk-');
  await expect(page.locator('.tool-page .probe')).toHaveCount(snapshot.tools[3].lastCheck!.probes.length);
  await page.locator('.tool-page').getByRole('button', { name: 'Bảng điều khiển', exact: false }).click();
  await openTool(page, 'codex');
  await expect(page.locator('.tool-page .models .m')).toHaveCount(2);
  await expect(page.locator('.tool-page .models .model-meta')).toHaveText(['Giá catalog', 'Giá catalog']);
});

test('check all stays sequential, shows progress, disables controls and ends with a success notice', async ({ page }) => {
  const snapshot = dashboardFixture(); const order: string[] = [];
  let inFlight = 0; let maximum = 0;
  await stubDashboard(page, snapshot);
  await page.route('**/api/dashboard/check', async route => {
    const agent = route.request().postDataJSON().agent as string; order.push(agent); maximum = Math.max(maximum, ++inFlight);
    await new Promise(resolve => setTimeout(resolve, 160)); inFlight--;
    const tool = snapshot.tools.find(tool => tool.agent === agent)!;
    await route.fulfill({ json: { ...tool, lastCheck: { ...tool.lastCheck, checkedAt: Date.now() } } });
  });
  await login(page);
  await page.getByRole('button', { name: 'Kiểm tra tất cả', exact: true }).click();
  await expect(page.locator('.dashboard-page .check-all')).toBeDisabled();
  await expect(page.locator('.dashboard-page .check-all')).toContainText('Đang kiểm tra');
  await expect(card(page, 'codex')).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => order.length).toBe(4);
  expect(maximum).toBe(1);
  expect(order).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
  await expect(page.locator('.dashboard-page .notice[role="status"]')).toContainText('Đã kiểm tra 4/4 công cụ.');
  await expect(page.locator('.dashboard-page .check-all')).toBeEnabled();
});

test('one failed probe does not block the other checks and its retry notice remains actionable', async ({ page }) => {
  const snapshot = dashboardFixture(); const order: string[] = [];
  await stubDashboard(page, snapshot);
  await page.route('**/api/dashboard/check', async route => {
    const agent = route.request().postDataJSON().agent as string; order.push(agent);
    if (agent === 'qodercli') return route.fulfill({ status: 500, json: { message: 'Không đọc được CLI.' } });
    return route.fulfill({ json: snapshot.tools.find(tool => tool.agent === agent) });
  });
  await login(page); await page.getByRole('button', { name: 'Kiểm tra tất cả', exact: true }).click();
  await expect.poll(() => order.length).toBe(4);
  expect(order).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
  const notice = page.locator('.dashboard-page .notice.error');
  await expect(notice).toContainText('Đã kiểm tra 3/4 công cụ');
  await expect(notice).toHaveAttribute('role', 'alert');
  await expect(notice.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
  await page.waitForTimeout(3200);
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect.poll(() => order.length).toBe(8);
});

test('individual check failures expose the reason without replacing cached data with zeros', async ({ page }) => {
  await stubDashboard(page);
  await page.route('**/api/dashboard/check', route => route.fulfill({ status: 500, json: { message: 'PTY không phản hồi' } }));
  await login(page); await card(page, 'codex').getByRole('button', { name: 'Kiểm tra Codex', exact: true }).click();
  await expect(page.locator('.dashboard-page .notice.error')).toContainText('PTY không phản hồi');
  await expect(card(page, 'codex').getByRole('img', { name: '5 giờ: 22%', exact: true })).toBeVisible();
});

test('unchecked, checking, failed, and unavailable tools have distinct states', async ({ page }) => {
  const snapshot = dashboardFixture();
  snapshot.tools[0].lastCheck = null;
  snapshot.tools[1].lastCheck = { ...snapshot.tools[1].lastCheck!, status: 'error', probes: [{ command: 'status', ok: false, exitCode: null, summary: 'PTY không phản hồi' }] };
  snapshot.tools[2].lastCheck = { ...snapshot.tools[2].lastCheck!, status: 'unavailable', version: null };
  await stubDashboard(page, snapshot);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dashboard/check', async route => { await gate; await route.fulfill({ json: dashboardFixture().tools[0] }); });
  await login(page);
  await expect(card(page, 'codex')).toContainText('Chưa kiểm tra');
  await expect(card(page, 'codex').locator('.donut')).toHaveCount(0);
  await expect(card(page, 'qodercli').getByRole('alert')).toContainText('PTY không phản hồi');
  await expect(card(page, 'agy')).toContainText('Chưa tìm thấy CLI');
  await card(page, 'codex').getByRole('button', { name: 'Kiểm tra Codex', exact: true }).click();
  await expect(card(page, 'codex')).toHaveAttribute('aria-busy', 'true');
  await expect(card(page, 'codex').getByRole('button', { name: 'Kiểm tra Codex', exact: true })).toContainText('Đang kiểm tra');
  release();
  await expect(card(page, 'codex').getByRole('img', { name: '5 giờ: 22%', exact: true })).toBeVisible();
});

test('missing quota and stopped pools retain unknown data instead of a zero percent value', async ({ page }) => {
  const snapshot = dashboardFixture();
  const qoder = snapshot.tools[1].lastCheck!;
  qoder.quotaWindows = []; qoder.credits.remaining = null;
  snapshot.tools[0].lastCheck!.quotaWindows![0].remainingPct = null;
  await stubDashboard(page, snapshot); await login(page);
  await expect(card(page, 'qodercli').locator('.credit b')).toHaveText('—');
  await expect(card(page, 'qodercli').getByRole('progressbar')).toHaveCount(0);
  await expect(card(page, 'qodercli')).not.toContainText('0%');
  await expect(card(page, 'codex').getByRole('img', { name: '5 giờ: —', exact: true })).toBeVisible();
  const routeway = card(page, 'opencode').locator('.pool-overview > div').filter({ hasText: 'routeway' });
  await expect(routeway).toContainText('Chưa có dữ liệu pool');
  await expect(routeway.getByRole('progressbar')).toHaveCount(0);
  await expect(routeway).not.toContainText('0%');
});
