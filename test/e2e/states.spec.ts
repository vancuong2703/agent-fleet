import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Plan, Run, Task, TaskResult } from '../../shared/types.js';

// Loading and failure states: every read must have a skeleton or a retry, and
// must never show the empty-state copy while it is still in flight.
let repoPath: string;
let token: string;

test.beforeEach(async () => {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('The E2E setup must provide a temporary FLEET_DATA_DIR');
  token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  repoPath = (await readFile(path.join(dataDir, 'repo-path'), 'utf8')).trim();
});

async function login(page: Page): Promise<void> {
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
}

async function createTask(page: Page, title: string, brief: string): Promise<Task> {
  const planResponse = await page.request.post('/api/plans', { data: { name: title, repoPath } });
  expect(planResponse.ok()).toBeTruthy();
  const plan = await planResponse.json() as Plan;
  const taskResponse = await page.request.post('/api/tasks', {
    data: { planId: plan.id, agent: 'fake', title, brief },
  });
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json() as Task;
  const waitResponse = await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });
  expect(waitResponse.ok()).toBeTruthy();
  const results = await waitResponse.json() as TaskResult[];
  expect(results[0]?.task.status).toBe('done');
  return results[0]!.task;
}

/**
 * Serve one synthetic finished task so the log state is deterministic: other
 * specs share the server, and a task created while a page is open would stream
 * its events before the log read could ever be slow.
 */
async function mockFinishedTask(
  page: Page,
  events: (route: Parameters<Parameters<Page['route']>[1]>[0]) => Promise<void>,
): Promise<Task> {
  const task: Task = {
    id: 't-state-log', planId: 'p-state', title: 'Synthetic log state', agent: 'fake',
    status: 'done', branch: 'fleet/synthetic/t-state-log', worktreePath: 'C:\\worktrees\\t-state-log',
    checkCmd: null, createdAt: 0, finishedAt: 1_000,
  };
  const run: Run = {
    id: 'r-state-log', taskId: task.id, attempt: 1, agent: 'fake', brief: 'synthetic', note: null,
    status: 'done', pid: null, exitCode: 0, startedAt: 0, endedAt: 1_000, durationMs: 1_000,
    checkPassed: true, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null,
    errorCategory: null, sessionId: null,
  };
  await page.route((url) => url.pathname === '/api/plans', (route) => route.fulfill({ json: [] }));
  await page.route((url) => url.pathname === '/api/tasks', (route) => route.fulfill({ json: [task] }));
  await page.route((url) => url.pathname === `/api/tasks/${task.id}/runs`, (route) => route.fulfill({ json: [run] }));
  await page.route((url) => url.pathname === `/api/runs/${run.id}/events`, events);
  return task;
}

test('a slow task sweep shows a skeleton and never the empty welcome', async ({ page }) => {
  await page.route((url) => url.pathname === '/api/plans', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.continue();
  });
  // Empty fleet keeps the post-load assertion deterministic even though other
  // specs share this server and leave tasks behind.
  await page.route((url) => url.pathname === '/api/tasks', (route) => route.fulfill({ json: [] }));
  // Do not wait for the connection here: the skeleton must be visible during the read.
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.locator('.welcome-skeleton')).toBeVisible();
  await expect(page.getByText('Bắt đầu một công việc mới.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Tạo task đầu tiên', { exact: true })).toHaveCount(0);
  await expect(page.locator('.welcome-skeleton')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.welcome h1')).toHaveText('Bắt đầu một công việc mới.');
});

test('a failing task sweep shows an error with retry instead of the empty welcome', async ({ page }) => {
  let fail = true;
  await page.route((url) => url.pathname === '/api/plans', (route) => fail
    ? route.fulfill({ status: 500, body: 'sweep down' })
    : route.fulfill({ json: [] }));
  // A successful retry must land on the empty fleet, not on another spec's task.
  await page.route((url) => url.pathname === '/api/tasks', (route) => route.fulfill({ json: [] }));
  await login(page);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  const errorScreen = page.locator('.welcome-error');
  await expect(errorScreen).toContainText('Chưa tải được danh sách công việc.');
  await expect(errorScreen).toContainText('sweep down');
  // The empty state must not be reachable while the read failed.
  await expect(page.getByText('Bắt đầu một công việc mới.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.welcome-steps')).toHaveCount(0);
  fail = false;
  await errorScreen.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.locator('.welcome h1')).toHaveText('Bắt đầu một công việc mới.');
  await expect(errorScreen).toHaveCount(0);
});

test('a slow log read shows a skeleton instead of "Chưa có sự kiện."', async ({ page }) => {
  const task = await mockFinishedTask(page, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    await route.fulfill({ json: [] });
  });
  await login(page);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.locator('.task-header h2')).toHaveText(task.title);
  await expect(page.locator('.log-skeleton')).toBeVisible();
  await expect(page.getByText('Chưa có sự kiện.', { exact: true })).toHaveCount(0);
  // The empty copy appears only after the read finished.
  await expect(page.locator('.log-empty')).toHaveText('Chưa có sự kiện.', { timeout: 15_000 });
  await expect(page.locator('.log-skeleton')).toHaveCount(0);
});

test('a failed log read shows the error and a retry instead of empty copy', async ({ page }) => {
  let fail = true;
  const task = await mockFinishedTask(page, async (route) => {
    if (fail) {
      await route.fulfill({ status: 500, body: 'log down' });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await login(page);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.locator('.task-header h2')).toHaveText(task.title);
  const banner = page.locator('.log-view .banner-error');
  await expect(banner).toContainText('Không tải được nhật ký: 500');
  await expect(page.getByText('Chưa có sự kiện.', { exact: true })).toHaveCount(0);
  fail = false;
  await banner.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.log-empty')).toHaveText('Chưa có sự kiện.');
});

test('Compare offers a retry after a failed read and leaves "Đang tải..."', async ({ page }) => {
  let statsCalls = 0;
  let agentCalls = 0;
  await page.route((url) => url.pathname === '/api/stats', async (route) => {
    statsCalls += 1;
    if (statsCalls === 1) await route.fulfill({ status: 503, body: 'stats down' });
    else await route.continue();
  });
  await page.route((url) => url.pathname === '/api/agents', async (route) => {
    agentCalls += 1;
    if (agentCalls === 1) await route.fulfill({ status: 503, body: 'agents down' });
    else await route.continue();
  });
  await login(page);
  await page.getByRole('button', { name: 'So sánh agent', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Không tải được số liệu');
  await expect(page.locator('.compare-empty')).toHaveText('Không tải được số liệu.');
  await expect(page.locator('.compare-empty')).not.toHaveText('Đang tải...');
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'codex' })).toBeVisible();
  expect(statsCalls).toBeGreaterThanOrEqual(2);
});

test('at 1000px the inspector starts closed and its close button hides it', async ({ page }) => {
  await page.setViewportSize({ width: 1_000, height: 900 });
  await login(page);
  const task = await createTask(page, 'Narrow inspector state', 'Narrow inspector smoke');
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: task.title, exact: false }).click();
  const toggle = page.getByRole('button', { name: 'Ẩn hoặc hiện thông tin workspace', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.inspector')).toBeVisible();
  await page.getByRole('button', { name: 'Đóng bảng thông tin', exact: true }).click();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('the empty work screen hides the inspector and lists the three steps', async ({ page }) => {
  // Synthetic empty fleet: other specs share the server, so no task may leak in.
  await page.route((url) => url.pathname === '/api/plans' || url.pathname === '/api/tasks',
    (route) => route.fulfill({ json: [] }));
  await login(page);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await expect(page.locator('.welcome-steps li')).toHaveCount(3);
  await expect(page.locator('.welcome-steps')).toContainText('Chọn repo');
  await expect(page.locator('.welcome-steps')).toContainText('Viết yêu cầu');
  await expect(page.locator('.welcome-steps')).toContainText('Duyệt thay đổi');
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ẩn hoặc hiện thông tin workspace', exact: true })).toHaveCount(0);
});

test('expanded raw log rows are real buttons', async ({ page }) => {
  await login(page);
  const task = await createTask(page, 'Raw log rows', '[[raw]] raw log rows');
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: task.title, exact: false }).click();
  const toggle = page.locator('button.raw-toggle');
  await expect(toggle).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  const rawLines = page.locator('button.log-line.kind-line-raw');
  await expect(rawLines).toHaveCount(2);
  await expect(page.locator('div.log-line[role="button"]')).toHaveCount(0);
  await rawLines.first().click();
  await expect(page.locator('button.raw-toggle')).toBeVisible();
});

test('the empty work screen fits three widths in both themes', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route((url) => url.pathname === '/api/plans' || url.pathname === '/api/tasks',
    (route) => route.fulfill({ json: [] }));
  await login(page);
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  for (const width of [375, 768, 1440]) {
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('.welcome-steps')).toBeVisible();
      await page.screenshot({ path: `.tmp/ui-qa/t11/welcome-${width}-${theme}.png`, fullPage: true, animations: 'disabled' });
    }
  }
});
