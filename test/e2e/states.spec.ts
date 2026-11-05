import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './nav-helpers.js';
import type { Run, Task } from '../../shared/types.js';

let token: string;
test.beforeEach(async () => { token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim(); });
async function login(page: Page) { await page.goto(`/auth?token=${encodeURIComponent(token)}`); }
async function jobs(page: Page) { await page.getByRole('button', { name: 'Công việc', exact: true }).click(); }
async function mockFinishedTask(page: Page, events: Parameters<Page['route']>[1]) {
  const task: Task = { id: 't-state-log', planId: 'p-state', title: 'Synthetic log state', agent: 'fake', status: 'done', branch: 'fleet/synthetic/t-state-log', worktreePath: 'C:\\worktrees\\t-state-log', checkCmd: null, createdAt: 0, finishedAt: 1000 };
  const run: Run = { id: 'r-state-log', taskId: task.id, attempt: 1, agent: 'fake', brief: 'synthetic', note: null, status: 'done', pid: null, exitCode: 0, startedAt: 0, endedAt: 1000, durationMs: 1000, checkPassed: true, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null };
  await page.route(url => url.pathname === '/api/plans', route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname === '/api/tasks', route => route.fulfill({ json: [task] }));
  await page.route(url => url.pathname === `/api/tasks/${task.id}/runs`, route => route.fulfill({ json: [run] }));
  await page.route(url => url.pathname === '/api/runs', route => route.fulfill({ json: [run] }));
  await page.route(url => url.pathname === `/api/tasks/${task.id}/diff`, route => route.fulfill({ json: { files: [], patch: '' } }));
  await page.route(url => url.pathname === `/api/runs/${run.id}/events`, events);
  return task;
}

test('slow job sweep shows a loading state and never premature empty guidance', async ({ page }) => {
  await page.route(url => url.pathname === '/api/plans', async route => { await new Promise(resolve => setTimeout(resolve, 1800)); await route.fulfill({ json: [] }); });
  await page.route(url => url.pathname === '/api/tasks', route => route.fulfill({ json: [] }));
  await login(page); await jobs(page);
  await expect(page.locator('.jobs-page [role="status"]')).toContainText('Đang tải công việc');
  await expect(page.getByRole('button', { name: 'Tạo công việc đầu tiên', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Bắt đầu công việc mới', exact: true })).toBeVisible();
  await expect(page.locator('.jobs-page [role="status"]')).toHaveCount(0);
});

test('failed job sweep offers retry and prevents empty state until it succeeds', async ({ page }) => {
  let fail = true;
  await page.route(url => url.pathname === '/api/plans', route => fail ? route.fulfill({ status: 500, body: 'sweep down' }) : route.fulfill({ json: [] }));
  await page.route(url => url.pathname === '/api/tasks', route => route.fulfill({ json: [] }));
  await login(page); await jobs(page);
  const alert = page.locator('.jobs-page [role="alert"]');
  await expect(alert).toContainText('sweep down');
  await expect(page.getByRole('heading', { name: 'Bắt đầu công việc mới', exact: true })).toHaveCount(0);
  fail = false; await alert.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Bắt đầu công việc mới', exact: true })).toBeVisible();
});

test('slow log read keeps a skeleton until the empty result is known', async ({ page }) => {
  await mockFinishedTask(page, async route => { await new Promise(resolve => setTimeout(resolve, 1800)); await route.fulfill({ json: [] }); });
  await login(page); await jobs(page);
  await expect(page.locator('.detail-title h2')).toHaveText('Synthetic log state');
  await expect(page.locator('.log-skeleton')).toBeVisible();
  await expect(page.getByText('Chưa có sự kiện.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.log-empty')).toHaveText('Chưa có sự kiện.');
  await expect(page.locator('.log-skeleton')).toHaveCount(0);
});

test('failed log read retains an actionable error and retry loads the result', async ({ page }) => {
  let fail = true;
  await mockFinishedTask(page, route => fail ? route.fulfill({ status: 500, body: 'log down' }) : route.fulfill({ json: [] }));
  await login(page); await jobs(page);
  const banner = page.locator('.log-view .banner-error');
  await expect(banner).toContainText('Không tải được nhật ký: 500');
  await expect(page.getByText('Chưa có sự kiện.', { exact: true })).toHaveCount(0);
  fail = false; await banner.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.log-empty')).toHaveText('Chưa có sự kiện.');
});

test('slow diff read keeps its count unknown and does not claim there are no changes', async ({ page }) => {
  await mockFinishedTask(page, route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname === '/api/tasks/t-state-log/diff', async route => { await new Promise(resolve => setTimeout(resolve, 1800)); await route.fulfill({ json: { files: [], patch: '' } }); });
  await login(page); await jobs(page);
  const changes = page.getByRole('tab', { name: 'Thay đổi', exact: true });
  await expect(changes).toBeVisible(); await changes.click();
  await expect(page.locator('.diff-skeleton')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Thay đổi (0)', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Thay đổi (0)', exact: true })).toBeVisible();
  await expect(page.locator('.diff-skeleton')).toHaveCount(0);
});

test('comparison keeps errors visible and its retry restores measured stats', async ({ page }) => {
  let fail = true; let calls = 0;
  await page.route(url => url.pathname === '/api/stats', route => { calls++; return fail ? route.fulfill({ status: 503, body: 'stats down' }) : route.fulfill({ json: [{ agent: 'codex', runs: 7, avgDurationMs: 42000, successRate: .9, retryRate: 0, mergeRate: .8, costUsd: null }] }); });
  await login(page); await page.getByRole('button', { name: 'So sánh agent', exact: true }).click();
  const compare = page.locator('.compare-page'); const alert = compare.getByRole('alert');
  await expect(alert).toContainText('stats down');
  await expect(compare.getByRole('button', { name: 'Xuất', exact: true })).toBeDisabled();
  fail = false; await alert.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(alert).toHaveCount(0);
  await expect(compare.getByRole('button', { name: 'Xuất', exact: true })).toBeEnabled();
  await expect(compare.locator('.card[data-tool="codex"] .stat .v').first()).toHaveText('42 s');
  expect(calls).toBeGreaterThanOrEqual(2);
});

test('empty jobs explain the complete workflow and do not display obsolete inspector controls', async ({ page }) => {
  await page.route(url => url.pathname === '/api/plans' || url.pathname === '/api/tasks', route => route.fulfill({ json: [] }));
  await login(page); await jobs(page);
  const empty = page.locator('.jobs-page .list .empty');
  await expect(empty).toContainText('Chọn repo → Viết yêu cầu → Duyệt thay đổi');
  await expect(empty.getByRole('button', { name: 'Tạo công việc đầu tiên', exact: true })).toBeVisible();
  await expect(page.locator('.inspector')).toHaveCount(0);
  await expect(page.locator('.detail')).toContainText('Chọn công việc để xem nhật ký, thay đổi và yêu cầu.');
});

test('raw log entries and their expand toggle remain keyboard accessible buttons', async ({ page }) => {
  const task = await mockFinishedTask(page, route => route.fulfill({ json: [{ seq: 1, runId: 'r-state-log', ts: 1000, event: { kind: 'raw', text: 'raw test output' } }] }));
  await login(page); await jobs(page);
  await expect(page.locator('.detail-title h2')).toHaveText(task.title);
  const toggle = page.locator('button.raw-toggle');
  await expect(toggle).toBeVisible(); await toggle.focus(); await page.keyboard.press('Enter');
  const rawLines = page.locator('button.log-line.kind-line-raw');
  await expect(rawLines).toHaveCount(1);
  await expect(rawLines.first()).toContainText('raw test output');
  await expect(page.locator('div.log-line[role="button"]')).toHaveCount(0);
});

test('empty job list and selected-job panel remain usable in both themes at every width', async ({ page }, info) => {
  await page.route(url => url.pathname === '/api/plans' || url.pathname === '/api/tasks', route => route.fulfill({ json: [] }));
  await login(page); await jobs(page);
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 }); await setTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('button', { name: 'Tạo công việc đầu tiên', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`empty-jobs-${width}-${theme}.png`), animations: 'disabled' });
  }
});
