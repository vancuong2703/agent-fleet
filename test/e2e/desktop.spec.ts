import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './nav-helpers.js';

test.beforeEach(async ({ page }) => {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
});

async function createFakeTask(page: Page, title: string) {
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  const plan = await (await page.request.post('/api/plans', { data: { name: title, repoPath } })).json();
  const task = await (await page.request.post('/api/tasks', { data: { planId: plan.id, agent: 'fake', title, brief: 'Desktop smoke' } })).json();
  await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10000 } });
  return task;
}

test('the single theme control cycles light, dark, system and persists the preference', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const theme = page.getByRole('button', { name: 'Giao diện', exact: true });
  await expect(theme).toHaveCount(1);
  await expect(theme).toContainText('Sáng');
  await theme.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(theme).toContainText('Tối');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.click();
  await expect(theme).toContainText('Hệ thống');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('fleet.theme'))).toBe('system');
});

test('desktop restores its native theme and sends updated preferences to the host', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fleet.theme', 'light');
    window.__FLEET_DESKTOP__ = { version: '2.4.0', theme: 'dark' };
    const messages: unknown[] = [];
    Object.assign(window, { nativeThemeMessages: messages });
    window.chrome = { webview: { postMessage: message => messages.push(message), addEventListener() {}, removeEventListener() {} } };
  });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Giao diện', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => (window as unknown as { nativeThemeMessages: unknown[] }).nativeThemeMessages)).toContainEqual({ type: 'fleet:set-theme', theme: 'system' });
});

test('dashboard is the default entry and never runs CLI checks on open', async ({ page }) => {
  const probes: string[] = [];
  page.on('request', entry => { if (entry.method() === 'POST' && entry.url().includes('/api/dashboard/check')) probes.push(entry.url()); });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
  await expect(page.locator('.zones > .card[data-tool]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(page.locator('.jobs-page')).toBeVisible();
  await expect(page.locator('.dashboard-host')).toBeHidden();
  expect(probes).toHaveLength(0);
});

test('hardware toggle changes the actual widget and view style survives reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 940 });
  const hardware = page.getByRole('button', { name: 'Phần cứng', exact: true });
  await expect(page.locator('#resStrip')).toBeVisible();
  await hardware.click();
  await expect(hardware).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#resStrip')).toBeHidden();
  await hardware.click();
  await expect(page.locator('#resStrip')).toBeVisible();
  await page.getByRole('button', { name: 'Sắc độ giao diện', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'plain');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', 'plain');
  await setTheme(page, 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-style', 'plain');
});

test('jobs show real vendor marks and keep title and status in distinct cells', async ({ page }) => {
  const task = await createFakeTask(page, 'Vendor identity smoke');
  await page.route(url => url.pathname === '/api/tasks', async route => {
    const response = await route.fetch();
    const rows = await response.json() as Array<{ id: string; agent: string }>;
    await route.fulfill({ response, json: rows.map(row => row.id === task.id ? { ...row, agent: 'codex' } : row) });
  });
  await page.reload();
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  const row = page.locator('.table.jobs tbody tr').filter({ hasText: 'Vendor identity smoke' });
  await expect(row.locator('.logo img')).toHaveCount(1);
  await expect(row.locator('.logo img')).toHaveJSProperty('complete', true);
  await row.getByRole('button', { name: 'Vendor identity smoke', exact: true }).click();
  await expect(page.locator('.detail-title h2')).toHaveText('Vendor identity smoke');
  await expect(row.locator('.badge')).toContainText('Chờ duyệt');
  const boxes = await Promise.all([row.locator('td').nth(0).boundingBox(), row.locator('td').nth(1).boundingBox(), row.locator('td').nth(2).boundingBox()]);
  expect(boxes.every(Boolean)).toBe(true);
  expect(boxes[0]!.x + boxes[0]!.width).toBeLessThanOrEqual(boxes[1]!.x + 1);
  expect(boxes[1]!.x + boxes[1]!.width).toBeLessThanOrEqual(boxes[2]!.x + 1);
});

test('job search restores focus after the palette and exports an actual usage file', async ({ page }) => {
  const task = await createFakeTask(page, 'Desktop search smoke');
  await page.reload();
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Tìm công việc hoặc dự án' });
  await search.fill('no-such-desktop-task');
  await expect(page.locator('.table.jobs .task-row')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Không có công việc phù hợp' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Tìm lệnh' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(search).toBeFocused();
  await search.fill(task.title);
  await expect(page.locator('.table.jobs .task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/^agent-fleet-usage-.*\.json$/);
});

test('native file reveal uses task identity and a relative path without shell commands', async ({ page }) => {
  await page.addInitScript(() => {
    window.__FLEET_DESKTOP__ = { version: '2.4.0', theme: 'light' };
    const callbacks = new Set<(event: MessageEvent) => void>();
    const requests: unknown[] = [];
    Object.assign(window, { nativeRequests: requests });
    window.chrome = { webview: {
      postMessage(message: unknown) { requests.push(message); const request = message as { requestId: string }; for (const callback of callbacks) callback(new MessageEvent('message', { data: { type: 'fleet:native-result', requestId: request.requestId, ok: true } })); },
      addEventListener(_type, callback) { callbacks.add(callback); }, removeEventListener(_type, callback) { callbacks.delete(callback); },
    } };
  });
  await page.reload();
  const task = await createFakeTask(page, 'Native bridge task');
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await page.getByRole('button', { name: task.title, exact: true }).click();
  await page.getByRole('tab', { name: 'Thay đổi (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Mở vị trí tệp', exact: true }).click();
  const requests = await page.evaluate(() => (window as unknown as { nativeRequests: Array<{ type: string }> }).nativeRequests.filter(entry => entry.type === 'fleet:open-path'));
  expect(requests).toEqual([expect.objectContaining({ type: 'fleet:open-path', taskId: task.id, relativePath: 'fake.txt', action: 'reveal' })]);
  expect(requests[0]).not.toHaveProperty('command');
});
