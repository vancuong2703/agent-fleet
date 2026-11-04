import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Plan, Run, Task, TaskStatus } from '../../shared/types.js';
import { setTheme } from './nav-helpers.js';

const PLAN: Plan = { id: 'p-nav', name: 'Kế hoạch điều hướng', slug: 'nav', repoPath: 'C:\\repos\\nav', baseBranch: 'main', createdAt: 0 };
function taskOf(id: string, title: string, status: TaskStatus, createdAt: number): Task {
  return { id, planId: PLAN.id, title, agent: 'fake', status, branch: `fleet/nav/${id}`, worktreePath: `C:\\worktrees\\${id}`, checkCmd: null, createdAt, finishedAt: null };
}
const TASKS = [taskOf('t-nav-run', 'Đang chạy kiểm thử', 'running', 4), taskOf('t-nav-queue', 'Chờ máy rảnh', 'queued', 3), taskOf('t-nav-review', 'Duyệt thay đổi', 'done', 2), taskOf('t-nav-fail', 'Lỗi khi merge', 'failed', 1)];
const RUN: Run = { id: 'r-nav', taskId: 't-nav-run', attempt: 1, agent: 'fake', brief: 'synthetic request', note: null, status: 'running', pid: null, exitCode: null, startedAt: 0, endedAt: null, durationMs: null, checkPassed: null, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null };

test.beforeEach(async ({ page }) => {
  await page.route(url => url.pathname === '/api/plans', route => route.fulfill({ json: [PLAN] }));
  await page.route(url => url.pathname === '/api/tasks', route => route.fulfill({ json: TASKS }));
  await page.route(url => /^\/api\/tasks\/[^/]+\/runs$/.test(url.pathname), route => {
    const id = route.request().url().split('/api/tasks/')[1]!.split('/')[0]!;
    return route.fulfill({ json: [{ ...RUN, id: `r-${id}`, taskId: id, status: TASKS.find(task => task.id === id)?.status ?? 'running' }] });
  });
  await page.route(url => /^\/api\/runs\/[^/]+\/events$/.test(url.pathname), route => route.fulfill({ json: [] }));
  await page.route(url => /^\/api\/tasks\/[^/]+\/diff$/.test(url.pathname), route => route.fulfill({ json: { files: [], patch: '' } }));
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
});

async function openJobs(page: Page) {
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(page.locator('.table.jobs')).toBeVisible();
}

test('job status filters distinguish running, queued and review and restore all rows', async ({ page }) => {
  await openJobs(page);
  const filters = page.getByRole('group', { name: 'Trạng thái công việc' });
  const rows = page.locator('.table.jobs .task-row');
  await expect(rows).toHaveCount(4);
  for (const [label, title] of [['Lỗi', 'Lỗi khi merge'], ['Đang chạy', 'Đang chạy kiểm thử'], ['Đang chờ', 'Chờ máy rảnh'], ['Chờ duyệt', 'Duyệt thay đổi']]) {
    await filters.getByRole('button', { name: label, exact: true }).click();
    await expect(filters.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText(title);
    await expect(filters.locator('[aria-pressed="true"]')).toHaveCount(1);
  }
  await filters.getByRole('button', { name: 'Tất cả', exact: true }).click();
  await expect(rows).toHaveCount(4);
});

test('job search and status filter combine and the empty state clears both', async ({ page }) => {
  await openJobs(page);
  await page.getByRole('group', { name: 'Trạng thái công việc' }).getByRole('button', { name: 'Lỗi', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tìm công việc hoặc dự án' }).fill('Đang chạy');
  await expect(page.locator('.table.jobs .task-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Xoá bộ lọc', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Tìm công việc hoặc dự án' })).toHaveValue('');
  await expect(page.locator('.table.jobs .task-row')).toHaveCount(4);
});

test('navigation marks exactly one current page and switches language consistently', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: 'Điều hướng chính' });
  await expect(nav.getByRole('button', { name: 'Bảng điều khiển', exact: true })).toHaveAttribute('aria-current', 'page');
  await openJobs(page);
  await expect(nav.getByRole('button', { name: 'Công việc', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Jobs', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('group', { name: 'Job status' }).getByRole('button', { name: 'Review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'VI', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Công việc', exact: true })).toBeVisible();
});

test('job status badges communicate status in text and selecting a row updates details', async ({ page }) => {
  await openJobs(page);
  for (const [title, status] of [['Đang chạy kiểm thử', 'Đang chạy'], ['Chờ máy rảnh', 'Đang chờ'], ['Duyệt thay đổi', 'Chờ duyệt'], ['Lỗi khi merge', 'Lỗi']]) {
    const row = page.locator('.table.jobs tbody tr').filter({ hasText: title });
    await expect(row.locator('.badge')).toHaveText(status);
    await row.getByRole('button').click();
    await expect(row.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.detail-title h2')).toHaveText(title);
    await expect(page.locator('.detail-title .badge')).toHaveText(status);
  }
});

test('job tabs are keyboard operated, wrap arrows and ignore shortcuts in an input', async ({ page }) => {
  await openJobs(page);
  const tabs = page.getByRole('tablist', { name: 'Chi tiết công việc' });
  const log = tabs.getByRole('tab', { name: 'Nhật ký', exact: true });
  const diff = tabs.getByRole('tab', { name: /^Thay đổi/ });
  const brief = tabs.getByRole('tab', { name: 'Yêu cầu', exact: true });
  await page.keyboard.press('2'); await expect(diff).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('3'); await expect(brief).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('1'); await expect(log).toHaveAttribute('aria-selected', 'true');
  await log.focus(); await page.keyboard.press('ArrowLeft');
  await expect(brief).toBeFocused(); await expect(brief).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home'); await expect(log).toBeFocused();
  await page.keyboard.press('End'); await expect(brief).toBeFocused();
  const search = page.getByRole('textbox', { name: 'Tìm công việc hoặc dự án' });
  await search.fill('123');
  await expect(brief).toHaveAttribute('aria-selected', 'true');
});

test('palette opens, filters, navigates and Escape restores the prior focused control', async ({ page }) => {
  await page.getByRole('button', { name: 'VI', exact: true }).focus();
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ô lệnh nhanh' });
  const input = palette.getByRole('combobox', { name: 'Tìm lệnh' });
  await expect(input).toBeFocused();
  await input.fill('so sánh'); await expect(palette.getByRole('option')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('button', { name: 'So sánh agent', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'VI', exact: true }).focus();
  await page.keyboard.press('Control+k'); await expect(palette).toBeVisible();
  await page.keyboard.press('Escape'); await expect(palette).toBeHidden();
  await expect(page.getByRole('button', { name: 'VI', exact: true })).toBeFocused();
});

test('palette jumps to a job and lists an action for each real CLI', async ({ page }) => {
  await page.keyboard.press('Control+k');
  const input = page.getByRole('combobox', { name: 'Tìm lệnh' });
  await input.fill('Lỗi khi merge'); await page.keyboard.press('Enter');
  await expect(page.locator('.table.jobs tr.sel .task-row')).toHaveText('Lỗi khi merge');
  await expect(page.locator('.detail-title h2')).toHaveText('Lỗi khi merge');
  await page.keyboard.press('Control+k'); await input.fill('Mở CLI');
  await expect(page.getByRole('dialog', { name: 'Ô lệnh nhanh' }).getByRole('option')).toHaveCount(4);
  await page.keyboard.press('Escape');
});

for (const width of [375, 768]) test(`at ${width}px drawer navigation is reachable and returns focus on Escape`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const toggle = page.getByRole('button', { name: 'Mở điều hướng', exact: true });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.locator('.workspace-sidebar')).toBeInViewport();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused(); await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.jobs-page')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
