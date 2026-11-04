import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Plan, Task } from '../../shared/types.js';
import { openComposer, setTheme } from './nav-helpers.js';

/**
 * T13 regression coverage for the terminal screen: ARIA tab keyboard
 * navigation, the reconnect banner, the wording of "Ẩn" vs "Kết thúc tiến
 * trình", the Vietnamese clipboard buttons and the remembered font size.
 */

const shots = '.tmp/ui-qa/t13';
test.beforeAll(async () => { await mkdir(shots, { recursive: true }); });

async function login(page: Page): Promise<void> {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('The E2E setup must provide a temporary FLEET_DATA_DIR');
  const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
}

/** Dashboard + terminal-session mocks must exist before the page boots, like `test/e2e/terminal.spec.ts`. */
async function fakeTerminalWorkspace(page: Page, options: { failFirstSocket?: boolean } = {}) {
  const tools = ['codex', 'agy'].map((agent) => ({
    agent, title: agent === 'codex' ? 'Codex' : 'Antigravity (AGY)', installed: true, configuredBin: null, lastCheck: null,
    suggestions: [{ id: `${agent}-status`, label: 'Trạng thái', command: '/status', context: 'interactive', description: 'Đọc trạng thái CLI.' }],
  }));
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: { generatedAt: Date.now(), tools, terminalSessions: [] } }));
  await page.route('**/api/terminal-sessions', (route) => {
    const { agent } = route.request().postDataJSON();
    return route.fulfill({ json: { id: `session-${agent}`, agent, title: `${agent} workspace`, cwd: 'C:\\workspace', source: 'workspace', planId: null, taskId: null, createdAt: Date.now(), connected: true, reconnectGraceMs: 300_000 } });
  });
  const state = { connections: 0, messages: [] as Array<{ t: string; d?: string }>, output: (_text: string) => {} };
  await page.routeWebSocket('**/ws/terminal?**', (socket) => {
    state.connections += 1;
    if (options.failFirstSocket && state.connections === 1) { void socket.close({ code: 1011, reason: 'boom' }); return; }
    socket.onMessage(message => state.messages.push(JSON.parse(String(message))));
    state.output = (text) => socket.send(JSON.stringify({ t: 'out', d: text }));
    state.output('terminal ready\r\n');
  });
  return state;
}

test('Ctrl+K opens the global palette from focused xterm without sending a control byte to the CLI', async ({ page }) => {
  const state = await fakeTerminalWorkspace(page);
  await login(page);
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Mở Codex', exact: true }).click();
  const input = page.locator('.terminal-session:not([hidden]) .xterm-helper-textarea');
  await expect(page.locator('.terminal-connection')).toHaveText('Đã kết nối');
  await input.focus();
  await expect(input).toBeFocused();
  const before = state.messages.length;
  await input.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ô lệnh nhanh' });
  await expect.poll(async () => ({ paletteOpen: await palette.isVisible(), cliInput: state.messages.slice(before).filter(message => message.t === 'in') })).toEqual({ paletteOpen: true, cliInput: [] });
  await expect(palette.getByRole('combobox', { name: 'Tìm lệnh' })).toBeFocused();
  expect(state.messages.slice(before).filter(message => message.t === 'in')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(input).toBeFocused();
});

async function openBothSessions(page: Page) {
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Mở Codex', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'Phiên mới', exact: true }).click();
  await page.getByRole('button', { name: 'Mở Antigravity (AGY)', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
}

test('terminal tabs are a real tablist, move with arrow keys, Home and End, and name the destructive action', async ({ page }) => {
  const state = await fakeTerminalWorkspace(page);
  await login(page);
  await openBothSessions(page);

  const tablist = page.getByRole('tablist', { name: 'Phiên CLI' });
  // ARIA tablists default to horizontal; the keyboard model verifies the orientation.
  const tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(2);
  const codex = tabs.nth(0);
  const agy = tabs.nth(1);
  // The session launched last is the active one.
  await expect(agy).toHaveAttribute('aria-selected', 'true');
  await codex.click();
  await expect(codex).toHaveAttribute('aria-selected', 'true');
  await expect(codex).toHaveAttribute('aria-controls', 'cli-session-codex');
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-session-codex');

  await codex.focus();
  await page.keyboard.press('ArrowRight');
  await expect(agy).toHaveAttribute('aria-selected', 'true');
  await expect(agy).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(codex).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(agy).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(codex).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(agy).toHaveAttribute('aria-selected', 'true');
  await expect(agy).toBeFocused();
  await expect(page.locator('.terminal-session:not([hidden])')).toHaveCount(1);
  await expect(page.locator('.terminal-session:not([hidden])')).toHaveAttribute('id', 'cli-session-agy');

  // Closing a tab here really ends the process, so the label must say so.
  const sessionPanel = page.locator('.terminal-session:not([hidden])');
  await expect(sessionPanel.getByRole('button', { name: 'Kết thúc tiến trình', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kết thúc phiên', exact: true })).toHaveCount(0);
  await expect(sessionPanel.getByRole('button', { name: 'Sao chép', exact: true })).toBeVisible();
  await expect(sessionPanel.getByRole('button', { name: 'Dán', exact: true })).toBeVisible();
  await sessionPanel.getByRole('button', { name: 'Ẩn terminal', exact: true }).click();
  await expect(sessionPanel.locator('.terminal-host')).toBeHidden();
  expect(state.connections).toBe(2);
  await sessionPanel.getByRole('button', { name: 'Hiện terminal', exact: true }).click();
  await expect(sessionPanel.locator('.terminal-host')).toBeVisible();
  expect(state.connections).toBe(2);
});

test('terminal shows a reconnect banner when the socket fails and reconnects on request', async ({ page }) => {
  const state = await fakeTerminalWorkspace(page, { failFirstSocket: true });
  await login(page);
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Mở Codex', exact: true }).click();
  const banner = page.locator('.terminal-reconnect');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('kết nối');
  expect(state.connections).toBe(1);
  await banner.getByRole('button', { name: 'Kết nối lại', exact: true }).click();
  await expect(page.locator('.terminal-connection')).toHaveText('Đã kết nối');
  await expect(banner).toHaveCount(0);
  expect(state.connections).toBe(2);
  state.output('after-reconnect\r\n');
  await expect(page.locator('.terminal-session:not([hidden]) .xterm-rows')).toContainText('after-reconnect');
});

test('a task terminal hides instead of closing, and the font size is remembered', async ({ page }) => {
  await login(page);
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  const plan = await (await page.request.post('/api/plans', { data: { name: 'Terminal labels plan', repoPath } })).json() as Plan;
  const task = await (await page.request.post('/api/tasks', { data: { planId: plan.id, agent: 'fake', title: 'Terminal labels task', brief: 'labels smoke' } })).json() as Task;
  await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });

  const openTaskTerminal = async () => {
    await page.getByRole('button', { name: 'Công việc', exact: true }).click();
    await page.getByRole('button', { name: /Terminal labels task/ }).click();
    await page.getByRole('button', { name: 'Mở terminal', exact: true }).click();
    const panel = page.locator('.terminal-panel');
    await expect(panel).toBeVisible();
    return panel;
  };

  // Inside a task the panel only hides; the PTY keeps running on the server.
  const panel = await openTaskTerminal();
  await expect(panel.getByRole('button', { name: 'Ẩn', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Đóng', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Sao chép', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Dán', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Paste', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Tăng cỡ chữ terminal' }).click();
  await panel.getByRole('button', { name: 'Tăng cỡ chữ terminal' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fleet.terminal.fontSize'))).toBe('17');
  // Hiding keeps the process, but a reload must still restore the size.
  await panel.getByRole('button', { name: 'Ẩn', exact: true }).click();
  await expect(page.locator('.terminal-panel')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
  const reopened = await openTaskTerminal();
  await expect(reopened.locator('.terminal-tools')).toContainText('17');
});

test('composer and terminal screenshots are readable in both themes', async ({ page }) => {
  await fakeTerminalWorkspace(page);
  await login(page);
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  const response = await page.request.post('/api/plans', { data: { name: 'Screenshot plan', repoPath } });
  expect(response.ok()).toBeTruthy();

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await openComposer(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `${shots}/composer-step-1-${theme}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await expect(dialog.locator('.composer-steps [aria-current="step"]')).toHaveText('2. Giao việc');
    await page.screenshot({ path: `${shots}/composer-step-2-${theme}.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.getByRole('button', { name: 'Terminal', exact: true }).click();
    // Reuse the already-open session in the second theme rather than recreating its id.
    if (!(await page.getByRole('tab').count())) await page.getByRole('button', { name: 'Mở Codex', exact: true }).click();
    await expect(page.getByRole('tablist', { name: 'Phiên CLI' })).toBeVisible();
    await page.screenshot({ path: `${shots}/terminal-${theme}.png`, fullPage: true });
    // No horizontal scrolling at the desktop width (playbook section 2).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Bảng điều khiển', exact: true }).click();
  }

  await page.setViewportSize({ width: 375, height: 720 });
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Tìm lệnh' }).fill('Tạo công việc mới');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: `${shots}/composer-375-light.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
