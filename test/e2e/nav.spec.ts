import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Plan, Run, Task, TaskStatus } from '../../shared/types.js';

// Navigation and the command palette: the topbar chips filter the sidebar, the
// task tabs are real tabs with 1/2/3 shortcuts, and ≤900px the sidebar becomes a
// rail with an overlay drawer instead of squeezing the content column.
let token: string;

test.beforeEach(async () => {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('The E2E setup must provide a temporary FLEET_DATA_DIR');
  token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
});

async function login(page: Page): Promise<void> {
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
}

const PLAN: Plan = {
  id: 'p-nav', name: 'Kế hoạch điều hướng', slug: 'nav', repoPath: 'C:\\repos\\nav',
  baseBranch: 'main', createdAt: 0,
};

function taskOf(id: string, title: string, status: TaskStatus, createdAt: number): Task {
  return {
    id, planId: PLAN.id, title, agent: 'fake', status, branch: `fleet/nav/${id}`,
    worktreePath: `C:\\worktrees\\${id}`, checkCmd: null, createdAt, finishedAt: null,
  };
}

const TASKS: Task[] = [
  taskOf('t-nav-run', 'Đang chạy kiểm thử', 'running', 3),
  taskOf('t-nav-queue', 'Chờ duyệt thay đổi', 'queued', 2),
  taskOf('t-nav-fail', 'Lỗi khi merge', 'failed', 1),
];

const RUN: Run = {
  id: 'r-nav', taskId: 't-nav-run', attempt: 1, agent: 'fake', brief: 'synthetic', note: null,
  status: 'running', pid: null, exitCode: null, startedAt: 0, endedAt: null, durationMs: null,
  checkPassed: null, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null,
  errorCategory: null, sessionId: null,
};

/** Deterministic fleet of three statuses, served from routes instead of real runs. */
async function mockFleet(page: Page): Promise<void> {
  await page.route((url) => url.pathname === '/api/plans', (route) => route.fulfill({ json: [PLAN] }));
  await page.route((url) => url.pathname === '/api/tasks', (route) => route.fulfill({ json: TASKS }));
  await page.route((url) => /^\/api\/tasks\/[^/]+\/runs$/.test(url.pathname), (route) => {
    const id = route.request().url().split('/api/tasks/')[1]!.split('/')[0]!;
    return route.fulfill({ json: id === RUN.taskId ? [RUN] : [] });
  });
  await page.route((url) => /^\/api\/tasks\/[^/]+\/diff$/.test(url.pathname), (route) => route.fulfill({ json: { files: [], patch: '' } }));
}

async function openTasks(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Công việc', exact: true }).first().click();
  await expect(page.locator('.task-list')).toBeVisible();
}

test('the topbar chips filter the sidebar and toggle back to every task', async ({ page }) => {
  await mockFleet(page);
  await login(page);
  await openTasks(page);

  const rows = page.locator('.task-list .task-row');
  await expect(rows).toHaveCount(3);

  const failedChip = page.locator('.status-chips').getByRole('button', { name: /Lỗi/ });
  await failedChip.click();
  await expect(failedChip).toHaveAttribute('aria-pressed', 'true');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Lỗi khi merge');

  const runningChip = page.locator('.status-chips').getByRole('button', { name: /Đang chạy/ });
  await runningChip.click();
  await expect(runningChip).toHaveAttribute('aria-pressed', 'true');
  await expect(failedChip).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Đang chạy kiểm thử');

  // Pressing the pressed chip again clears the filter instead of trapping the view.
  await runningChip.click();
  await expect(runningChip).toHaveAttribute('aria-pressed', 'false');
  await expect(rows).toHaveCount(3);
});

test('the waiting chip shows the queued task and its nav badge', async ({ page }) => {
  await mockFleet(page);
  await login(page);
  await openTasks(page);

  await expect(page.locator('.nav-waiting')).toContainText('1 chờ duyệt');
  await page.locator('.status-chips').getByRole('button', { name: /Chờ duyệt/ }).click();
  const rows = page.locator('.task-list .task-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Chờ duyệt thay đổi');
});

test('nav marks the current screen and names every button in Vietnamese', async ({ page }) => {
  await mockFleet(page);
  await login(page);

  const nav = page.locator('.workspace-nav');
  await expect(nav.getByRole('button', { name: 'Công việc', exact: true })).toBeVisible();
  await expect(nav.getByRole('button', { name: 'Tasks' })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Bảng điều khiển', exact: true })).toHaveAttribute('aria-current', 'page');

  await openTasks(page);
  await expect(nav.getByRole('button', { name: 'Công việc', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: 'Bảng điều khiển', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.workspace-nav [aria-current="page"]')).toHaveCount(1);
});

test('sidebar status is an icon with an accessible name, not a bare glyph', async ({ page }) => {
  await mockFleet(page);
  await login(page);
  await openTasks(page);

  const icons = page.locator('.task-list .status-icon');
  await expect(icons).toHaveCount(3);
  for (const label of ['đang chạy', 'đang chờ', 'lỗi']) {
    await expect(page.locator(`.task-list .status-icon[aria-label="${label}"]`)).toHaveCount(1);
  }
  await expect(icons.first()).toHaveAttribute('role', 'img');
  await expect(icons.first().locator('svg')).toHaveCount(1);
});

test('task detail tabs are real tabs driven by the 1/2/3 keys', async ({ page }) => {
  await mockFleet(page);
  await login(page);
  await openTasks(page);
  await page.locator('.task-list .task-row').first().click();

  const tablist = page.getByRole('tablist', { name: 'Chi tiết công việc' });
  await expect(tablist).toBeVisible();
  const log = page.getByRole('tab', { name: 'Nhật ký' });
  const diff = page.getByRole('tab', { name: /^Thay đổi/ });
  const brief = page.getByRole('tab', { name: 'Yêu cầu' });
  await expect(log).toHaveAttribute('aria-selected', 'true');

  await page.keyboard.press('2');
  await expect(diff).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toBeVisible();
  await page.keyboard.press('3');
  await expect(brief).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('1');
  await expect(log).toHaveAttribute('aria-selected', 'true');

  // Arrow keys move within the tablist as well.
  await log.focus();
  await page.keyboard.press('ArrowRight');
  await expect(diff).toHaveAttribute('aria-selected', 'true');
});

test('the palette opens with Ctrl+K, filters, runs a command and closes with Escape', async ({ page }) => {
  await mockFleet(page);
  await login(page);

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ô lệnh nhanh' });
  await expect(palette).toBeVisible();
  const input = palette.getByRole('combobox', { name: 'Tìm lệnh' });
  await expect(input).toBeFocused();

  // Filtering is by label or by hidden keyword (a view slug here).
  await input.fill('so sánh');
  await expect(palette.getByRole('option')).toHaveCount(1);
  await expect(palette.getByRole('option').first()).toContainText('So sánh agent');

  await page.keyboard.press('Enter');
  await expect(palette).toBeHidden();
  await expect(page.locator('.workspace-nav [aria-current="page"]')).toHaveText('So sánh agent');
  await expect(page.getByRole('heading', { name: /So sánh/ })).toBeVisible();

  // Escape closes and returns focus to the button that opened it.
  await page.getByRole('button', { name: 'Mở ô lệnh nhanh' }).click();
  await expect(palette).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
  await expect(page.getByRole('button', { name: 'Mở ô lệnh nhanh' })).toBeFocused();
});

test('the palette can jump to a task and offers an agent per CLI', async ({ page }) => {
  await mockFleet(page);
  await login(page);

  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ô lệnh nhanh' });
  const input = palette.getByRole('combobox', { name: 'Tìm lệnh' });
  await input.fill('Lỗi khi merge');
  await expect(palette.getByRole('option').first()).toContainText('Lỗi khi merge');
  await input.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.locator('.task-list .task-row.selected')).toContainText('Lỗi khi merge');

  await page.keyboard.press('Control+k');
  await input.fill('open');
  const agentOption = palette.getByRole('option').filter({ hasText: 'Mở CLI OpenCode' });
  await expect(agentOption).toHaveCount(1);
  await page.keyboard.press('Escape');
});

test.describe('narrow windows', () => {
  test('at 820px the sidebar is a rail and opens as a drawer', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await mockFleet(page);
    await login(page);

    const sidebar = page.locator('.workspace-sidebar');
    await expect(sidebar).toBeVisible();
    // Rail: icons only, no nav text and no task list, and the content keeps its width.
    await expect(page.locator('.workspace-sidebar .nav-label').first()).toBeHidden();
    await expect(page.locator('.task-list')).toBeHidden();
    const railWidth = (await sidebar.boundingBox())!.width;
    expect(railWidth).toBeLessThanOrEqual(60);
    const mainWidth = (await page.locator('.workspace-shell').boundingBox())!.width;
    expect(mainWidth).toBeGreaterThan(720);

    const toggle = page.getByRole('button', { name: 'Mở thanh bên' });
    await toggle.click();
    await expect(page.locator('.workspace-sidebar .nav-label').first()).toBeVisible();
    await expect(page.locator('.task-list')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.task-list')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Mở thanh bên' })).toBeFocused();
  });

  test('at 480px the drawer starts closed and does not shrink the content', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await mockFleet(page);
    await login(page);

    const sidebar = page.locator('.workspace-sidebar');
    // The drawer is translated fully off-canvas, so it holds no part of the viewport.
    await expect(sidebar).not.toBeInViewport();
    const shell = (await page.locator('.workspace-shell').boundingBox())!;
    expect(shell.width).toBeGreaterThanOrEqual(470);
    // No horizontal scrollbar in the page itself.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Mở thanh bên' }).click();
    await expect(sidebar).toBeInViewport();
    await expect(page.locator('.task-list')).toBeVisible();
    await expect(page.locator('.sidebar-scrim')).toBeVisible();

    await page.locator('.sidebar-scrim').click({ position: { x: 400, y: 400 } });
    await expect(sidebar).not.toBeInViewport();
  });

  test('chips, tabs and rail read at 375/768/1440 in both themes', async ({ page }) => {
    await mockFleet(page);
    await login(page);
    await openTasks(page);
    await page.locator('.task-list .task-row').first().click();

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      // Resizing mid-session keeps the inspector choice made at the wide width;
      // close it so the screenshot shows the content column the user gets on a
      // device that starts narrow.
      const inspectorToggle = page.getByRole('button', { name: 'Ẩn hoặc hiện thông tin workspace' });
      if (width < 1050 && (await page.locator('.inspector').count()) > 0) await inspectorToggle.click();
      for (const theme of ['light', 'dark'] as const) {
        // The theme buttons live in the sidebar, which is a rail/drawer at these
        // widths, so switch the theme through the palette — available everywhere.
        await page.keyboard.press('Control+k');
        const palette = page.getByRole('dialog', { name: 'Ô lệnh nhanh' });
        await expect(palette).toBeVisible();
        await palette.getByRole('combobox', { name: 'Tìm lệnh' }).fill(theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối');
        await page.keyboard.press('Enter');
        await expect(palette).toBeHidden();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${width}px ${theme} must not scroll horizontally`).toBeLessThanOrEqual(0);
        await page.screenshot({ path: `.tmp/ui-qa/t14/nav-${width}-${theme}.png`, fullPage: false, animations: 'disabled' });
      }
    }
  });
});
