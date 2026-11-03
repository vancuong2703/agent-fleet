import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Plan, Task, TaskResult } from '../../shared/types.js';

let repoPath: string;

test.beforeEach(async ({ page }) => {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('The E2E setup must provide a temporary FLEET_DATA_DIR');
  const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  repoPath = (await readFile(path.join(dataDir, 'repo-path'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL('http://127.0.0.1:4610/');
  await expect(page.getByRole('button', { name: 'Tasks', exact: true })).toBeVisible();
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
});

async function createTask(page: Page, title: string, brief = 'UI smoke test', checkCmd?: string): Promise<Task> {
  const planResponse = await page.request.post('/api/plans', {
    data: { name: title, repoPath },
  });
  expect(planResponse.ok()).toBeTruthy();
  const plan = await planResponse.json() as Plan;
  const taskResponse = await page.request.post('/api/tasks', {
    data: { planId: plan.id, agent: 'fake', title, brief, checkCmd },
  });
  expect(taskResponse.ok()).toBeTruthy();
  return await taskResponse.json() as Task;
}

async function waitForDone(page: Page, task: Task): Promise<void> {
  const response = await page.request.post('/api/wait', {
    data: { ids: [task.id], timeoutMs: 10_000 },
  });
  expect(response.ok()).toBeTruthy();
  const results = await response.json() as TaskResult[];
  expect(results[0]?.task.status).toBe('done');
  await page.getByRole('button', { name: task.title, exact: false }).click();
  await expect(page.locator('.task-header .status-badge')).toHaveClass(/status-done/);
}

test('new task and log lines arrive live without reloading', async ({ page }) => {
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });

  const task = await createTask(page, 'Live log smoke', '[[slow]] UI live log');
  const taskRow = page.getByRole('button', { name: task.title, exact: false });
  await expect(taskRow).toBeVisible();
  await taskRow.click();
  const messages = page.locator('.log-line.kind-line-message .log-text');
  await expect(messages.first()).toHaveText('slow 1');
  const initialCount = await messages.count();
  expect(initialCount).toBeLessThan(5);
  await expect.poll(() => messages.count()).toBeGreaterThan(initialCount);
  await expect(messages).toHaveText(['slow 1', 'slow 2', 'slow 3', 'slow 4', 'slow 5']);
  await expect(page.locator('.task-header .status-badge')).toHaveClass(/status-done/);
  expect(navigations).toBe(0);
});

test('finished task shows fake.txt and its patch in Diff', async ({ page }) => {
  const task = await createTask(page, 'Diff smoke');
  await waitForDone(page, task);
  await page.getByRole('button', { name: 'Diff (1)', exact: true }).click();
  await expect(page.getByRole('button', { name: /fake\.txt/ })).toBeVisible();
  await expect(page.locator('.diff-pane .diff-add')).toContainText('fake agent completed');
});

test('failed check is visible and cannot be merged', async ({ page }) => {
  const task = await createTask(page, 'Failed check smoke', 'UI smoke test', 'exit 1');
  const response = await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });
  expect(response.ok()).toBeTruthy();
  const results = await response.json() as TaskResult[];
  expect(results[0]?.run).toMatchObject({ status: 'failed', errorCategory: 'check', checkPassed: false });
  await page.getByRole('button', { name: task.title, exact: false }).click();
  await expect(page.locator('.task-header .status-badge')).toHaveClass(/status-failed/);
  await expect(page.locator('.task-check')).toHaveText('Kiểm tra: FAIL');
  await expect(page.getByRole('alert')).toContainText('Kiểm tra thất bại');
  await expect(page.getByRole('button', { name: 'Merge', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mở terminal', exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('failed-check.png'), fullPage: true });
});

test('finished fake task opens a working cmd terminal', async ({ page }) => {
  const task = await createTask(page, 'Terminal smoke');
  await waitForDone(page, task);
  await page.getByRole('button', { name: 'Mở terminal', exact: true }).click();
  const terminal = page.locator('.terminal-panel .xterm');
  await expect(terminal).toBeVisible();
  // Wait for the real shell prompt so input is sent after the PTY socket opens.
  const rows = terminal.locator('.xterm-rows');
  await expect(rows).toContainText('>');
  const input = terminal.locator('textarea');
  await input.pressSequentially('echo hi');
  await input.press('Enter');
  // A separate output row proves the shell executed the command, beyond echoing input.
  await expect(rows.locator('div').filter({ hasText: /^hi\s*$/ })).toBeVisible();
  await input.pressSequentially('exit');
  await input.press('Enter');
  await expect(rows).toContainText('phiên đã kết thúc');
  await page.getByRole('button', { name: 'Đóng', exact: true }).click();
  await expect(terminal).toHaveCount(0);
});

test('Compare shows the fake agent and its completed runs', async ({ page }) => {
  const task = await createTask(page, 'Compare smoke');
  await waitForDone(page, task);
  // Other E2E scenarios intentionally create failed runs. Compare the UI to
  // its actual stats response instead of assuming the shared history is 100%.
  const statsResponse = await page.request.get('/api/stats?sinceDays=7');
  expect(statsResponse.ok()).toBeTruthy();
  const stats = await statsResponse.json() as Array<{ agent: string; runs: number; successRate: number }>;
  const fake = stats.find((entry) => entry.agent === 'fake')!;
  expect(fake.runs).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'So sánh agent', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByText('fake', { exact: true }) });
  await expect(row).toBeVisible();
  await expect(row.getByRole('cell').nth(1)).toHaveText(String(fake.runs));
  await expect(row.getByRole('cell').nth(2)).toHaveText(`${Math.round(fake.successRate * 100)}%`);
});
