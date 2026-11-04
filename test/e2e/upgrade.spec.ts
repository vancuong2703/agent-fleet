import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openComposer } from './nav-helpers.js';

async function login(page: Page) {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
}
const dashboardTool = (agent: string, title: string, lastCheck: unknown = null) => ({
  agent, title, configuredBin: null, installed: true, lastCheck,
  suggestions: [{ id: `${agent}-status`, label: 'Trạng thái', command: `${agent} status`, context: 'shell', description: 'Read status at shell.' }, { id: `${agent}-help`, label: 'Trợ giúp', command: '/help', context: 'interactive', description: 'Read CLI help.' }],
});
const readyCheck = {
  checkedAt: 1730000000000, status: 'ready', version: '1.2.3',
  account: { state: 'authenticated', label: 'user@example.com', source: 'status', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: 'status', reason: 'CLI không expose quota' },
  credits: { remaining: null, unit: null, resetAt: null, source: 'status', reason: 'Không đọc được credit từ CLI' },
  probes: [{ command: 'version', ok: true, exitCode: 0, summary: '1.2.3' }],
};
const session = { id: 'session-upgrade', agent: 'codex', title: 'Phiên workspace', cwd: 'C:\\workspace', source: 'workspace', planId: null, taskId: null, createdAt: Date.now(), connected: true, reconnectGraceMs: 300000 };

test('dashboard reads never probe and a manual check updates only the requested tool', async ({ page }) => {
  const checks: unknown[] = [];
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex'), dashboardTool('agy', 'Antigravity', readyCheck)], terminalSessions: [] } }));
  await page.route('**/api/dashboard/check', route => { checks.push(route.request().postDataJSON()); return route.fulfill({ json: dashboardTool('codex', 'Codex', readyCheck) }); });
  await login(page);
  const codex = page.locator('.dashboard-page .card[data-tool="codex"]');
  await expect(codex).toContainText('Chưa kiểm tra');
  await expect(page.locator('.dashboard-page .card[data-tool="agy"]')).toContainText('1.2.3');
  expect(checks).toHaveLength(0);
  await codex.getByRole('button', { name: 'Kiểm tra Codex', exact: true }).click();
  await expect.poll(() => checks).toEqual([{ agent: 'codex' }]);
  await expect(codex).toContainText('1.2.3');
  await expect(page.locator('.dashboard-page .card[data-tool="agy"]')).toContainText('CLI không expose quota');
});

test('navigation preserves mounted dashboard and terminal sessions without recreating sockets', async ({ page }) => {
  let sockets = 0;
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex', readyCheck)], terminalSessions: [session] } }));
  await page.routeWebSocket('**/ws/terminal?**', socket => { sockets++; socket.send(JSON.stringify({ t: 'out', d: 'Codex session ready\r\n' })); });
  await login(page);
  await page.locator('.dashboard-page').evaluate(el => { el.setAttribute('data-mounted-sentinel', 'preserved'); });
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.terminal-panel .xterm-rows')).toContainText('Codex session ready');
  expect(sockets).toBe(1);
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(page.locator('.terminal-workspace-host')).toBeHidden();
  await page.getByRole('button', { name: 'Bảng điều khiển', exact: true }).click();
  await expect(page.locator('.dashboard-page')).toHaveAttribute('data-mounted-sentinel', 'preserved');
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.terminal-panel .xterm-rows')).toContainText('Codex session ready');
  expect(sockets).toBe(1);
});

test('ending a process requires confirmation and issues the explicit session DELETE', async ({ page }) => {
  let sessions = [session]; const deleted: string[] = [];
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex', readyCheck)], terminalSessions: sessions } }));
  await page.route('**/api/terminal-sessions/session-upgrade', route => { deleted.push(route.request().method()); sessions = []; return route.fulfill({ status: 204 }); });
  await page.routeWebSocket('**/ws/terminal?**', socket => socket.send(JSON.stringify({ t: 'out', d: 'ready\r\n' })));
  await login(page); await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.terminal-panel').getByRole('button', { name: 'Kết thúc tiến trình', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Huỷ bỏ', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Huỷ bỏ', exact: true }).click();
  expect(deleted).toEqual([]);
  await page.locator('.terminal-panel').getByRole('button', { name: 'Kết thúc tiến trình', exact: true }).click();
  await dialog.getByRole('button', { name: 'Kết thúc tiến trình', exact: true }).click();
  await expect.poll(() => deleted).toEqual(['DELETE']);
  await expect(page.getByRole('tab', { name: session.title, exact: true })).toHaveCount(0);
});

test('opening CLI uses the selected agent and stable geometry never loops resize', async ({ page }) => {
  const messages: Array<{ t: string }> = []; const launches: unknown[] = [];
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex', readyCheck)], terminalSessions: [] } }));
  await page.route('**/api/terminal-sessions', route => { launches.push(route.request().postDataJSON()); return route.fulfill({ json: session }); });
  await page.routeWebSocket('**/ws/terminal?**', socket => { socket.onMessage(message => messages.push(JSON.parse(String(message)))); socket.send(JSON.stringify({ t: 'out', d: 'Codex CLI ready\r\n' })); });
  await page.setViewportSize({ width: 1440, height: 940 }); await login(page);
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Mở Codex', exact: true }).click();
  await expect(page.locator('.terminal-panel')).toBeInViewport({ ratio: .7 });
  await expect(page.locator('.xterm-rows')).toContainText('Codex CLI ready');
  expect(launches).toEqual([{ agent: 'codex' }]);
  await page.waitForTimeout(400);
  const before = messages.filter(message => message.t === 'resize').length;
  await page.waitForTimeout(1000);
  expect(messages.filter(message => message.t === 'resize')).toHaveLength(before);
  await page.getByRole('button', { name: 'Giao diện', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForTimeout(300);
  expect(messages.filter(message => message.t === 'resize')).toHaveLength(before);
  await expect(page.locator('.terminal-host')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
});

test('resource model breakdown retains generic models, attribution and distinct credit totals', async ({ page }) => {
  const snapshot = {
    sampledAt: Date.now(), app: { version: '2.4.0', platform: 'win32', nodeVersion: '24', uptimeMs: 1000, desktop: false },
    resource: { sampledAt: Date.now(), scope: 'server-only', cpuPercent: 5, memoryBytes: 120e6, peakMemoryBytes: 140e6, cpuTimeMs: 8000, processCount: 2, gpu: null },
    history: [], system: { totalMemoryBytes: 32e9, usedMemoryBytes: 16e9, logicalCpuCount: 16 },
    usage: { planId: null, taskCount: 0, runCount: 3, completedRuns: 3, inputTokens: 1000, outputTokens: 400, costUsd: .5, credits: 10, reportedCredits: 14, coverage: { tokenRuns: 3, costRuns: 2, creditRuns: 1, totalRuns: 3 }, resources: { measuredRuns: 1, peakMemoryBytes: 140e6, observedCpuTimeMs: 8000 } },
    plans: [], runs: [], activeJobs: [], usageByTool: [],
    usageByModel: [
      { agent: 'agy', model: 'gemini-pro', provider: 'google', attribution: 'reported', inputTokens: 600, outputTokens: 200, credits: 8, reportedCredits: 11 },
      { agent: 'agy', model: 'qfmodel', provider: null, attribution: 'configured', inputTokens: 300, outputTokens: 150, credits: null, reportedCredits: null },
      { agent: 'agy', model: null, provider: null, attribution: 'unattributed', inputTokens: 100, outputTokens: 50, credits: null, reportedCredits: null },
    ], notes: [],
  };
  await page.route('**/api/observability**', route => route.fulfill({ json: snapshot }));
  await login(page); await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
  await page.locator('.diagnostics > summary').click();
  const table = page.getByRole('table', { name: 'Mức sử dụng theo model' });
  await expect(table.getByRole('cell', { name: 'gemini-pro', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'qfmodel', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Chưa gán được model', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'configured', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'unattributed', exact: true })).toBeVisible();
  const row = table.getByRole('row').filter({ hasText: 'gemini-pro' });
  await expect(row.locator('td').nth(4)).toHaveText('8'); await expect(row.locator('td').nth(5)).toHaveText('11');
  await expect(table.getByRole('row').filter({ hasText: 'qfmodel' }).locator('td').nth(4)).toHaveText('—');
});

test('AGY defaults to auto, scoped command permissions belong to the run and other agents omit them', async ({ page }) => {
  await login(page);
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  const plan = await (await page.request.post('/api/plans', { data: { name: 'Policy plan', repoPath } })).json();
  await page.reload();
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/tasks', route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>; payloads.push(body);
    return route.fulfill({ json: { id: `task-policy-${payloads.length}`, planId: plan.id, title: body.title, agent: body.agent, status: 'queued', branch: 'fleet/policy', worktreePath: repoPath, checkCmd: null, createdAt: Date.now(), finishedAt: null } });
  });
  const submit = async (agent: string, extra?: () => Promise<void>) => {
    await openComposer(page); const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(plan.id);
    await dialog.getByLabel('Agent', { exact: true }).selectOption(agent);
    await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
    await dialog.getByLabel('Tên công việc', { exact: true }).fill(`Policy ${payloads.length}`);
    await dialog.getByLabel('Nội dung giao việc', { exact: true }).fill('Synthetic policy smoke');
    if (extra) await extra();
    await dialog.getByRole('button', { name: 'Giao việc', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  const auto = page.getByRole('checkbox', { name: /Tự duyệt lệnh terminal/ });
  await submit('agy', async () => { await expect(auto).toBeChecked(); });
  expect(payloads[0]).toMatchObject({ agent: 'agy', commandPolicy: 'auto' });
  expect(payloads[0]).not.toHaveProperty('allowedCommands');
  await submit('agy', async () => { await auto.uncheck(); await page.getByLabel('Phạm vi quyền AGY').selectOption('check-only'); await page.getByLabel('Lệnh được cho phép thêm').fill('npm test\nnode check.cjs'); });
  expect(payloads[1]).toMatchObject({ agent: 'agy', commandPolicy: 'check-only', allowedCommands: ['npm test', 'node check.cjs'] });
  await submit('codex');
  expect(payloads[2]).not.toHaveProperty('commandPolicy'); expect(payloads[2]).not.toHaveProperty('allowedCommands');
});

test('suggested shell and interactive commands copy only and are never sent to the PTY', async ({ page }) => {
  const messages: Array<{ t: string }> = [];
  await page.addInitScript(() => { const copied: string[] = []; Object.assign(window, { copiedHints: copied }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { copied.push(text); } } }); });
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex', readyCheck)], terminalSessions: [session] } }));
  await page.routeWebSocket('**/ws/terminal?**', socket => { socket.onMessage(message => messages.push(JSON.parse(String(message)))); socket.send(JSON.stringify({ t: 'out', d: 'ready\r\n' })); });
  await login(page); await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.getByRole('button', { name: 'Sao chép Trạng thái', exact: true }).click();
  await page.getByRole('button', { name: 'Sao chép Trợ giúp', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { copiedHints: string[] }).copiedHints)).toEqual(['codex status', '/help']);
  expect(messages.filter(message => message.t === 'in')).toHaveLength(0);
  await expect(page.locator('.session-command button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Điền vào terminal/ })).toHaveCount(0);
});
