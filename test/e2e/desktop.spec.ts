import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

test.beforeAll(async () => { await mkdir('.tmp/ui-qa', { recursive: true }); });

test.beforeEach(async ({ page }) => {
  const dataDir = process.env.FLEET_DATA_DIR!;
  const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
});

async function createFakeTask(page: import('@playwright/test').Page, title: string, brief: string, agent = 'fake') {
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  const plan = await (await page.request.post('/api/plans', { data: { name: `Desktop plan ${title}`, repoPath } })).json();
  const task = await (await page.request.post('/api/tasks', { data: { planId: plan.id, agent, title, brief } })).json();
  if (agent === 'fake') await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });
  return { plan, task };
}

test('theme starts light without a saved choice and overrides the operating system mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Giao diện sáng' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Giao diện tối' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Giao diện tối' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Giao diện tối' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '.tmp/ui-qa/empty-dark.png', fullPage: true });
});

test('theme switcher offers exactly three accessible icon buttons', async ({ page }) => {
  const group = page.getByRole('group', { name: 'Giao diện' });
  await expect(group.getByRole('button')).toHaveCount(3);
  await expect(page.getByRole('combobox', { name: 'Giao diện' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Theo hệ thống' }).click();
  await expect(page.getByRole('button', { name: 'Theo hệ thống' })).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('desktop restores its native theme across local server origins', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('fleet.theme', 'light');
    window.__FLEET_DESKTOP__ = { version: '2.1.0', theme: 'dark' };
    const messages: unknown[] = [];
    Object.assign(window, { nativeThemeMessages: messages });
    window.chrome = { webview: { postMessage: (message) => messages.push(message), addEventListener() {}, removeEventListener() {} } };
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Giao diện tối' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Theo hệ thống' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const messages = await page.evaluate(() => (window as unknown as { nativeThemeMessages: unknown[] }).nativeThemeMessages);
  expect(messages).toContainEqual({ type: 'fleet:set-theme', theme: 'system' });
});

test('dashboard is the default entry and never runs CLI checks on open', async ({ page, request }) => {
  const posts: string[] = [];
  page.on('request', (entry) => { if (entry.method() === 'POST' && entry.url().includes('/api/dashboard/check')) posts.push(entry.url()); });
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Bảng điều khiển' })).toBeVisible();
  await page.waitForTimeout(1_000);
  expect(posts).toHaveLength(0);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeHidden();
  await expect(page.locator('.main:visible')).toBeVisible();
  await page.screenshot({ path: '.tmp/ui-qa/dashboard-light.png', fullPage: true });
});

test('sidebar rows show the vendor logo before the title and status after it', async ({ page }) => {
  const { task } = await createFakeTask(page, 'Logo order task', 'Desktop logo smoke');
  // Exercise the actual vendor image with a fake run; E2E must never invoke a paid CLI.
  await page.route(/\/api\/tasks(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    const tasks = await response.json() as Array<{id:string;agent:string}>;
    await route.fulfill({response,json:tasks.map(entry=>entry.id===task.id?{...entry,agent:'codex'}:entry)});
  });
  await page.reload();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  const row = page.locator('.task-row', { hasText: 'Logo order task' });
  await expect(row).toBeVisible();
  await row.click();
  const logo = row.locator('.task-row-agent img');
  await expect(logo).toHaveCount(1);
  const [logoBox, titleBox, statusBox] = await Promise.all([logo.boundingBox(), row.locator('.task-row-title').boundingBox(), row.locator('.status-icon').boundingBox()]);
  expect(logoBox && titleBox && statusBox).toBeTruthy();
  expect(logoBox!.x).toBeLessThan(titleBox!.x);
  expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(statusBox!.x + 1);
  const header = page.locator('.task-header-top');
  await expect(header.locator('.agent-mark img')).toHaveCount(1);
  await expect(header.locator('.agent-mark')).toBeVisible();
  const headerLogoBox = await header.locator('.agent-mark').boundingBox();
  const headerTitleBox = await header.locator('.task-header-title').boundingBox();
  expect(headerLogoBox!.x).toBeLessThan(headerTitleBox!.x);
});

test('sidebar and inspector widths follow the pointer and persist across reload', async ({ page }) => {
  await createFakeTask(page, 'Layout anchor task', 'Desktop layout smoke');
  await page.reload();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Layout anchor task/ }).click();
  const sidebar = page.locator('.workspace-sidebar');
  const before = (await sidebar.boundingBox())!;
  const handle = page.getByRole('separator', { name: 'Điều chỉnh độ rộng thanh bên' });
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => ((await sidebar.boundingBox())!.width - before.width)).toBeGreaterThan(40);
  await page.waitForTimeout(400);
  await page.reload();
  await expect.poll(async () => ((await sidebar.boundingBox())!.width - before.width)).toBeGreaterThan(40);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Layout anchor task/ }).click();
  const inspectorHandle = page.getByRole('separator', { name: 'Điều chỉnh độ rộng bảng thông tin' });
  const inspectorBox = (await inspectorHandle.boundingBox())!;
  await page.mouse.move(inspectorBox.x + inspectorBox.width / 2, inspectorBox.y + inspectorBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(inspectorBox.x + inspectorBox.width / 2 - 80, inspectorBox.y + inspectorBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => ((await page.locator('.inspector').boundingBox())!.width)).toBeGreaterThan(340);
  const requestedInspector = Number(await inspectorHandle.getAttribute('aria-valuenow'));
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('fleet.layout')) ?? '{}').inspectorWidth).toBe(requestedInspector);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({width:900,height:720});
  await expect.poll(async () => Math.round((await page.locator('.inspector').boundingBox())!.width)).toBe(260);
  await page.waitForTimeout(300); // longer than the preference persistence debounce
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('fleet.layout')) ?? '{}').inspectorWidth).toBe(requestedInspector);
  await page.setViewportSize(viewport);
  await expect.poll(async () => Math.round((await page.locator('.inspector').boundingBox())!.width)).toBe(requestedInspector);
  const saved = await page.evaluate(() => localStorage.getItem('fleet.layout'));
  expect(saved).toContain('sidebarWidth');
  const valueNow = Number(await handle.getAttribute('aria-valuenow'));
  const valueMax = Number(await handle.getAttribute('aria-valuemax'));
  expect(valueNow).toBeGreaterThan(before.width + 20);
  expect(valueNow).toBeLessThanOrEqual(valueMax);
  await page.screenshot({ path: '.tmp/ui-qa/layout-light.png', fullPage: true });
});

test('keyboard resize clamps inside min and max bounds', async ({ page }) => {
  const handle = page.getByRole('separator', { name: 'Điều chỉnh độ rộng thanh bên' });
  await handle.focus();
  for (let index = 0; index < 5; index++) await page.keyboard.press('ArrowLeft');
  const min = Number(await handle.getAttribute('aria-valuemin'));
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(min);
  await page.keyboard.press('End');
  const max = Number(await handle.getAttribute('aria-valuemax'));
  expect(Number(await handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(max);
  await page.keyboard.press('Home');
  await expect.poll(async () => Number(await handle.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(min + 1);
});

test('terminal keeps the CMD black palette in light and dark and persists its height', async ({ page }) => {
  const { task } = await createFakeTask(page, 'Terminal palette task', 'Desktop terminal smoke');
  await page.reload();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Terminal palette task/ }).click();
  await page.getByRole('button', { name: 'Mở terminal', exact: true }).click();
  const panel = page.locator('.terminal-panel');
  await expect(panel.locator('.terminal-connection')).toHaveText('Đã kết nối');
  await expect(panel.locator('.terminal-host')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
  const terminal = panel.locator('.xterm');
  await terminal.locator('textarea').pressSequentially('echo Agent Fleet Desktop');
  await terminal.locator('textarea').press('Enter');
  await expect(terminal.locator('.xterm-rows div').filter({ hasText: /^Agent Fleet Desktop\s*$/ })).toBeVisible();
  const heightHandle = page.getByRole('separator', { name: 'Điều chỉnh chiều cao terminal' });
  const heightBox = (await heightHandle.boundingBox())!;
  const heightBefore = (await panel.boundingBox())!.height;
  await page.mouse.move(heightBox.x + heightBox.width / 2, heightBox.y + heightBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(heightBox.x + heightBox.width / 2, heightBox.y + heightBox.height / 2 - 90, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.height - heightBefore).toBeGreaterThan(50);
  await page.getByRole('button', { name: 'Giao diện tối' }).click();
  await expect(panel.locator('.terminal-host')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
  await page.waitForTimeout(400);
  await page.reload();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Terminal palette task/ }).click();
  await page.getByRole('button', { name: 'Mở terminal', exact: true }).click();
  await expect.poll(async () => (await panel.locator('.terminal-host').boundingBox())!.height).toBeGreaterThan(200);
  await page.screenshot({ path: '.tmp/ui-qa/terminal-dark.png', fullPage: true });
  await panel.getByRole('button', { name: 'Đóng' }).click();
});

test('creates work in the app, filters the sidebar and exports measured usage', async ({ page }) => {
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  await page.route('**/api/agents', (route) => route.fulfill({ json: [{ id: 'fake', ok: true, maxParallel: 4 }] }));
  await page.getByRole('button', { name: /Task mới/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tên công việc', { exact: true }).fill('Desktop composer task');
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
  await dialog.getByLabel('Tên plan', { exact: true }).fill('Desktop plan');
  await dialog.getByLabel('Đường dẫn Git repository', { exact: true }).fill(repoPath);
  await dialog.getByLabel('Nội dung giao việc', { exact: true }).fill('Desktop composer smoke test');
  await dialog.getByRole('button', { name: 'Kiểm tra agent', exact: true }).click();
  await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('fake');
  await dialog.getByRole('button', { name: 'Giao việc', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.task-header-title')).toHaveText('Desktop composer task');
  await expect(page.locator('.task-header .status-badge')).toHaveClass(/status-done/);
  await page.getByLabel('Tìm task hoặc dự án').fill('no-such-desktop-task');
  await expect(page.locator('.sidebar')).toContainText('Không tìm thấy task phù hợp.');
  await page.keyboard.press('Control+k');
  await expect(page.getByLabel('Tìm task hoặc dự án')).toBeFocused();
  await page.getByLabel('Tìm task hoặc dự án').fill('Desktop composer');
  await expect(page.locator('.sidebar .task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tài nguyên & mức sử dụng', exact: true })).toBeVisible();
  await expect(page.locator('.usage-page')).toContainText('Desktop plan');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất báo cáo', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^agent-fleet-usage-.*\.json$/);
  await page.screenshot({ path: '.tmp/ui-qa/usage-light.png', fullPage: true });
});

test('native file action uses task identity and relative path, without exposing arbitrary shell commands', async ({ page }) => {
  await page.addInitScript(() => {
    window.__FLEET_DESKTOP__ = { version: '2.1.0', theme: 'light' };
    const callbacks = new Set<(event: MessageEvent) => void>();
    const requests: unknown[] = [];
    Object.assign(window, { nativeRequests: requests });
    window.chrome = { webview: {
      postMessage(message: unknown) { requests.push(message); const request = message as { requestId: string }; for (const callback of callbacks) callback(new MessageEvent('message', { data: { type: 'fleet:native-result', requestId: request.requestId, ok: true } })); },
      addEventListener(_type, callback) { callbacks.add(callback); },
      removeEventListener(_type, callback) { callbacks.delete(callback); },
    } };
  });
  await page.reload();
  const { task } = await createFakeTask(page, 'Native bridge task', 'Native bridge smoke');
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: /Native bridge task/ }).click();
  await page.getByRole('button', { name: 'Diff (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Mở vị trí tệp', exact: true }).click();
  const requests = await page.evaluate(() => (window as unknown as { nativeRequests: Array<{ type: string }> }).nativeRequests.filter((entry) => entry.type === 'fleet:open-path'));
  expect(requests).toEqual([expect.objectContaining({ type: 'fleet:open-path', taskId: task.id, relativePath: 'fake.txt', action: 'reveal' })]);
  expect(requests[0]).not.toHaveProperty('command');
  await page.screenshot({ path: '.tmp/ui-qa/workspace-light.png', fullPage: true });
  await page.getByRole('button', { name: 'Log', exact: true }).click();
  await page.getByRole('button', { name: 'Giao diện tối' }).click();
  await page.getByRole('button', { name: 'Mở terminal', exact: true }).click();
  await expect(page.locator('.terminal-connection')).toHaveText('Đã kết nối');
  const terminal = page.locator('.terminal-panel .xterm');
  await expect(terminal.locator('.xterm-rows')).toContainText('>');
  await terminal.locator('textarea').pressSequentially('echo Agent Fleet Desktop');
  await terminal.locator('textarea').press('Enter');
  await expect(terminal.locator('.xterm-rows div').filter({ hasText: /^Agent Fleet Desktop\s*$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Đóng' }).click();
});
