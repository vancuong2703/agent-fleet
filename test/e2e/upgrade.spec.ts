import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page) {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
}

const dashboardTool = (agent: string, title: string, lastCheck: unknown = null) => ({
  agent, title, configuredBin: null, installed: true, lastCheck,
  suggestions: [
    { id: `${agent}-status`, label: 'Trạng thái', command: `${agent} status`, context: 'shell', description: 'Kiểm tra nhanh trạng thái tại shell.' },
    { id: `${agent}-help`, label: 'Trợ giúp', command: '/help', context: 'interactive', description: 'Xem trợ giúp trong phiên CLI.' },
  ],
});

const readyCheck = {
  checkedAt: 1_730_000_000_000, status: 'ready', version: '1.2.3',
  account: { state: 'authenticated', label: 'user@example.com', source: 'cli status', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: 'CLI không expose quota' },
  credits: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: 'Không đọc được credit từ CLI' },
  probes: [{ command: 'version', ok: true, exitCode: 0, summary: '1.2.3' }],
};

test('dashboard GET never checks and manual check updates a single tool', async ({ page }) => {
  const checks: unknown[] = [];
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex'), dashboardTool('agy', 'Antigravity', readyCheck)], terminalSessions: [] } }));
  await page.route('**/api/dashboard/check', (route) => { checks.push(route.request().postDataJSON()); route.fulfill({ json: dashboardTool('codex', 'Codex', readyCheck) }); });
  await login(page);
  expect(checks).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Kiểm tra Codex' })).toBeEnabled();
  await expect(page.locator('.tool-card', { hasText: 'Codex' })).toContainText('Chưa kiểm tra');
  await expect(page.locator('.tool-card', { hasText: 'Antigravity' })).toContainText('1.2.3');
  await page.getByRole('button', { name: 'Kiểm tra Codex' }).click();
  await expect.poll(() => checks.length).toBe(1);
  expect(checks[0]).toEqual({ agent: 'codex' });
  await expect(page.locator('.tool-card', { hasText: 'Codex' })).toContainText('1.2.3');
  await expect(page.locator('.tool-card', { hasText: 'Antigravity' })).toContainText('CLI không expose quota');
});

test('dashboard stays mounted across navigation and reuses live terminal sessions', async ({ page }) => {
  const session = { id: 'session-keep-1', agent: 'codex', title: 'Phiên workspace', cwd: 'C:\\workspace', source: 'workspace', planId: null, taskId: null, createdAt: Date.now(), connected: true, reconnectGraceMs: 300_000 };
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex', readyCheck)], terminalSessions: [session] } }));
  await login(page);
  await page.getByRole('button', {name:'Phiên workspace',exact:true}).click();
  await expect(page.locator('.terminal-workspace-host .terminal-panel')).toBeVisible();
  await expect(page.locator('.terminal-workspace-host .terminal-panel')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.locator('.dashboard-host')).toBeHidden();
  await page.getByRole('button', { name: 'Terminal',exact:true }).click();
  await expect(page.locator('.terminal-workspace-host .terminal-panel')).toBeVisible();
  await expect(page.locator('.terminal-title')).toContainText('Codex');
});

test('terminal session launch and explicit close call the documented API', async ({ page }) => {
  const created = { id: 'session-e2e-9', agent: 'opencode', title: 'OpenCode · workspace', cwd: 'C:\\safe\\workspace', source: 'workspace', planId: null, taskId: null, createdAt: Date.now(), connected: true, reconnectGraceMs: 300_000 };
  const deleted: string[] = [];
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('opencode', 'OpenCode', readyCheck)], terminalSessions: [created] } }));
  await page.route('**/api/terminal-sessions', (route) => route.request().method() === 'POST' ? route.fulfill({ json: created }) : route.fallback());
  await page.route('**/api/terminal-sessions/session-e2e-9', (route) => { deleted.push(route.request().method()); route.fulfill({ status: 204 }); });
  await login(page);
  await page.getByRole('button', {name:'OpenCode · workspace',exact:true}).click();
  await expect(page.locator('.terminal-workspace-host .terminal-panel')).toBeVisible();
  await page.getByRole('button', {name:'Bảng điều khiển',exact:true}).click();
  await expect(page.locator('.terminal-workspace-host')).toBeHidden();
  await page.getByRole('button', {name:'Terminal',exact:true}).click();
  await expect(page.locator('.terminal-workspace-host .terminal-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Kết thúc OpenCode · workspace',exact:true }).click();
  await page.getByRole('button', { name: 'Kết thúc', exact: true }).click();
  await expect.poll(() => deleted).toEqual(['DELETE']);
  await expect(page.getByRole('tab', {name:'OpenCode · workspace'})).toHaveCount(0);
});

test('opening CLI reveals the terminal and stable geometry never loops resize', async ({ page }) => {
  const messages: Array<{t:string;cols?:number;rows?:number}> = [];
  const session = { id:'stable-console',agent:'codex',title:'Codex workspace',cwd:'C:\\workspace',source:'workspace',planId:null,taskId:null,createdAt:Date.now(),connected:true,reconnectGraceMs:300000 };
  await page.route('**/api/dashboard', route => route.fulfill({json:{generatedAt:Date.now(),tools:[dashboardTool('codex','Codex',readyCheck)],terminalSessions:[]}}));
  await page.route('**/api/terminal-sessions', route => route.fulfill({json:session}));
  await page.routeWebSocket('**/ws/terminal?**', socket => {
    socket.onMessage(message => messages.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({t:'out',d:'Codex CLI ready\r\n'}));
  });
  await page.setViewportSize({width:1100,height:700});
  await login(page);
  await page.getByRole('button',{name:'Mở Codex',exact:true}).click();
  await expect(page.locator('.terminal-panel')).toBeInViewport({ratio:0.7});
  await expect(page.locator('.xterm-rows')).toContainText('Codex CLI ready');
  await page.waitForTimeout(500);
  const before=messages.filter(m=>m.t==='resize').length;
  await page.waitForTimeout(1200);
  expect(messages.filter(m=>m.t==='resize').length).toBe(before);
  await page.getByRole('button',{name:'Giao diện tối'}).click();
  await page.waitForTimeout(250);
  expect(messages.filter(m=>m.t==='resize').length).toBe(before);
});

test('usage pages list every model, generic names, and the unattributed bucket', async ({ page }) => {
  const coverage = { tokenRuns: 3, costRuns: 2, creditRuns: 1, totalRuns: 3 };
  const metrics = { runCount: 3, inputTokens: 900, outputTokens: 300, costUsd: 0.5, credits: 10, reportedCredits: 14, coverage };
  const snapshot = {
    sampledAt: Date.now(),
    app: { version: '2.1.0', platform: 'win32', nodeVersion: 'v26.3.0', uptimeMs: 1_000, desktop: false },
    resource: { sampledAt: Date.now(), scope: 'server-only', cpuPercent: 5, memoryBytes: 120 * 1024 ** 2, peakMemoryBytes: 140 * 1024 ** 2, cpuTimeMs: 8_000, processCount: 2, gpu: null },
    history: [],
    system: { totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 16 * 1024 ** 3, logicalCpuCount: 16 },
    usage: { planId: null, taskCount: 2, runCount: 3, completedRuns: 3, inputTokens: 1_000, outputTokens: 400, costUsd: 0.5, credits: 10, reportedCredits: 14, coverage, resources: { measuredRuns: 1, peakMemoryBytes: 140 * 1024 ** 2, observedCpuTimeMs: 8_000 } },
    plans: [],
    runs: [{ taskId: 't-1', runId: 'r-1', agent: 'agy', status: 'completed', model: 'gemini-pro', modelSource: 'reported', models: [{ name: 'gemini-pro', provider: 'google', source: 'reported', generic: false }, { name: 'qfmodel', provider: null, source: 'configured', generic: true }], currentActivity: 'done', lastEventAt: Date.now(), silentForMs: 0, inputTokens: 600, outputTokens: 200, costUsd: 0.4, credits: 8, reportedCredits: 11, usageByModel: [
      { agent: 'agy', model: 'gemini-pro', provider: 'google', attribution: 'reported', ...metrics, runCount: 2, inputTokens: 600, outputTokens: 200 },
      { agent: 'agy', model: null, provider: null, attribution: 'unattributed', ...metrics, runCount: 1, inputTokens: 100, outputTokens: 50, credits: null, reportedCredits: null },
    ], resources: null }],
    activeJobs: [],
    usageByTool: [{ agent: 'agy', models: [{ name: 'gemini-pro', provider: 'google', source: 'reported', generic: false }, { name: 'qfmodel', provider: null, source: 'configured', generic: true }], ...metrics }],
    usageByModel: [
      { agent: 'agy', model: 'gemini-pro', provider: 'google', attribution: 'reported', ...metrics, runCount: 2, inputTokens: 600, outputTokens: 200 },
      { agent: 'agy', model: 'qfmodel', provider: null, attribution: 'configured', ...metrics, runCount: 1, inputTokens: 300, outputTokens: 150, credits: null, reportedCredits: null },
      { agent: 'agy', model: null, provider: null, attribution: 'unattributed', ...metrics, runCount: 1, inputTokens: 100, outputTokens: 50, credits: null, reportedCredits: null },
    ],
    notes: [],
  };
  await page.route('**/api/observability**', (route) => route.fulfill({ json: snapshot }));
  await login(page);
  await page.getByRole('button', { name: 'Tài nguyên & sử dụng', exact: true }).click();
  const modelTable = page.getByRole('table', { name: 'Mức sử dụng theo model' });
  await expect(modelTable.getByRole('cell', { name: 'gemini-pro', exact: false })).toBeVisible();
  await expect(modelTable.locator('code', { hasText: 'qfmodel' })).toBeVisible();
  await expect(modelTable.getByText('Chưa gán được model')).toBeVisible();
  await expect(modelTable.getByText('Cấu hình CLI').first()).toBeVisible();
  const toolTable = page.getByRole('table', { name: 'Mức sử dụng theo công cụ' });
  await expect(toolTable.getByText('reportedCredits', { exact: true })).toHaveCount(0);
  await expect(toolTable.locator('code', { hasText: 'qfmodel' })).toBeVisible();
  const headerCells = await page.getByRole('table', { name: 'Mức sử dụng theo công cụ' }).locator('th').allInnerTexts();
  expect(headerCells).toContain('Credit thanh toán');
  expect(headerCells).toContain('Credit danh nghĩa');
});

test('AGY composer defaults to auto, sends policy per run, and omits it for other agents', async ({ page }) => {
  await login(page);
  const repoPath = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
  const plan = await (await page.request.post('/api/plans', { data: { name: 'Policy plan', repoPath } })).json();
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/tasks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    payloads.push(body);
    route.fulfill({ json: { id: `task-e2e-${payloads.length}`, planId: plan.id, title: body.title, agent: body.agent, status: 'queued', branch: 'fleet/policy', worktreePath: repoPath, checkCmd: null, createdAt: Date.now(), finishedAt: null } });
  });
  const openComposer = async (agent: string, title: string, extra?: () => Promise<void>) => {
    await page.getByRole('button', { name: /Task mới/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Tên công việc', { exact: true }).fill(title);
    await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(plan.id);
    await dialog.getByLabel('Agent', { exact: true }).selectOption(agent);
    await dialog.getByLabel('Nội dung giao việc', { exact: true }).fill('Policy smoke');
    if (extra) await extra();
    await dialog.getByRole('button', { name: 'Giao việc', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  };
  const autoBox = page.getByRole('checkbox', { name: /Tự duyệt lệnh terminal/ });
  await openComposer('agy', 'AGY auto task', async () => {
    await expect(page.getByText('Quyền lệnh AGY cho lần chạy này')).toBeVisible();
    await expect(autoBox).toBeChecked();
  });
  expect(payloads[0]).toMatchObject({ agent: 'agy', commandPolicy: 'auto' });
  expect(payloads[0]).not.toHaveProperty('allowedCommands');
  await openComposer('agy', 'AGY check-only task', async () => {
    await autoBox.uncheck();
    await page.getByLabel('Phạm vi quyền AGY').selectOption('check-only');
    await page.getByLabel('Lệnh được cho phép thêm').fill('npm test\nnode check.cjs');
  });
  expect(payloads[1]).toMatchObject({ agent: 'agy', commandPolicy: 'check-only', allowedCommands: ['npm test', 'node check.cjs'] });
  await openComposer('codex', 'Codex default task');
  expect(payloads[2]).not.toHaveProperty('commandPolicy');
  expect(payloads[2]).not.toHaveProperty('allowedCommands');
});

test('dashboard suggested commands copy text and never auto-send shell commands', async ({ page }) => {
  const sent: string[] = [];
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: { generatedAt: Date.now(), tools: [dashboardTool('codex', 'Codex', readyCheck)], terminalSessions: [] } }));
  await page.route('**/api/terminal-sessions', (route) => route.request().method() === 'POST' ? route.fulfill({ json: { id: 'session-copy-1', agent: 'codex', title: 'Codex · workspace', cwd: 'C:\\workspace', source: 'workspace', planId: null, taskId: null, createdAt: Date.now(), connected: false, reconnectGraceMs: 300_000 } }) : route.fallback());
  await login(page);
  await page.getByRole('button', { name: 'Mở Codex' }).click();
  await expect(page.locator('.terminal-workspace-host')).toBeVisible();
  await page.locator('.terminal-commands summary').click();
  const hint = page.locator('.command-hint', { hasText: 'Trạng thái' });
  await expect(hint.locator('span')).toContainText('CMD / PowerShell');
  await expect(hint.getByRole('button', { name: /Điền vào terminal/ })).toHaveCount(0);
  const interactive = page.locator('.command-hint', { hasText: 'Trợ giúp' });
  await expect(interactive.getByRole('button', { name: /Điền vào terminal/ })).toBeDisabled();
});
