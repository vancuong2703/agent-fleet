import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Task, Run } from '../../shared/types.js';
import { referenceFixture } from './reference-fixture.js';

function createMockTokenData() {
  const now = Date.now();
  const ONE_DAY = 86_400_000;
  const tasks: Task[] = [];
  const runs: Run[] = [];

  // Generate runs for 7 days
  for (let i = 0; i < 7; i++) {
    const startedAt = now - (6 - i) * ONE_DAY;
    const taskId = `t-tok-${i}`;
    const runId = `r-tok-${i}`;
    tasks.push({
      id: taskId,
      planId: 'p-reference',
      title: `Token test task day ${i}`,
      agent: 'codex',
      status: 'done',
      branch: `fleet/tok/${i}`,
      worktreePath: `C:\\fixture\\tok\\${i}`,
      checkCmd: null,
      createdAt: startedAt,
      finishedAt: startedAt + 10_000,
    });
    runs.push({
      id: runId,
      taskId,
      agent: 'codex',
      attempt: 1,
      brief: `Token brief ${i}`,
      note: null,
      status: 'done',
      pid: null,
      exitCode: 0,
      startedAt,
      endedAt: startedAt + 10_000,
      durationMs: 10_000,
      checkPassed: true,
      inputTokens: 10_000 + i * 2_000,
      outputTokens: 2_000 + i * 500,
      costUsd: null,
      finalMessage: null,
      errorCategory: null,
      sessionId: null,
    });
  }

  return { tasks, runs };
}

test.describe('Dashboard Daily Token Usage Chart', () => {
  test('renders 7 day columns with labels, today badge, detail tooltip and keyboard escape', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'vi');
      localStorage.setItem('fleet.theme', 'light');
    });

    await referenceFixture(page);
    const { tasks, runs } = createMockTokenData();
    await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: tasks }));
    await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: runs }));
    await page.route(/\/api\/tasks\/t-tok-\d+\/runs$/, route => {
      const match = /t-tok-(\d+)/.exec(route.request().url());
      const taskId = match ? `t-tok-${match[1]}` : '';
      return route.fulfill({ json: runs.filter(r => r.taskId === taskId) });
    });

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    // Verify .daily-token-chart is inside .row3 [data-card-id="tokens"]
    const tokenCard = page.locator('.row3 [data-card-id="tokens"]');
    await expect(tokenCard).toBeVisible();
    const chart = tokenCard.locator('.daily-token-chart');
    await expect(chart).toBeVisible();

    // Verify 7 day columns rendered
    const cols = tokenCard.locator('.token-bar-col');
    await expect(cols).toHaveCount(7);

    // Verify labels on each column: weekday and monthday
    for (let i = 0; i < 7; i++) {
      const col = cols.nth(i);
      await expect(col.locator('.weekday')).toBeVisible();
      await expect(col.locator('.monthday')).toBeVisible();
    }

    // 7th column is today
    const todayCol = cols.nth(6);
    await expect(todayCol).toHaveClass(/is-today/);
    await expect(todayCol.locator('.today-badge')).toBeVisible();

    // Verify vertical alignment across all 7 columns (regression check)
    const firstBarArea = await cols.nth(0).locator('.token-bar-area').boundingBox();
    const firstWeekday = await cols.nth(0).locator('.weekday').boundingBox();
    expect(firstBarArea).not.toBeNull();
    expect(firstWeekday).not.toBeNull();

    for (let i = 1; i < 7; i++) {
      const barAreaBox = await cols.nth(i).locator('.token-bar-area').boundingBox();
      const weekdayBox = await cols.nth(i).locator('.weekday').boundingBox();
      expect(barAreaBox).not.toBeNull();
      expect(weekdayBox).not.toBeNull();
      expect(Math.abs(barAreaBox!.y - firstBarArea!.y)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(barAreaBox!.height - firstBarArea!.height)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(weekdayBox!.y - firstWeekday!.y)).toBeLessThanOrEqual(0.5);
    }

    // Hover or click today column to open tooltip
    await todayCol.click();
    const tooltip = todayCol.locator('.token-day-detail');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText(/Input \/ Output/i);
    await expect(tooltip).toContainText(/Lần chạy|Runs/i);

    // Escape closes tooltip
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
  });

  test('switches between chart and accessible 7-row data table', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });

    await referenceFixture(page);
    const { tasks, runs } = createMockTokenData();
    await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: tasks }));
    await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: runs }));
    await page.route(/\/api\/tasks\/t-tok-\d+\/runs$/, route => {
      const match = /t-tok-(\d+)/.exec(route.request().url());
      const taskId = match ? `t-tok-${match[1]}` : '';
      return route.fulfill({ json: runs.filter(r => r.taskId === taskId) });
    });

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const tokenCard = page.locator('.row3 [data-card-id="tokens"]');
    const toggleBtn = tokenCard.locator('.token-view-toggle');
    await expect(toggleBtn).toContainText('View data');

    // Click View data
    await toggleBtn.click();
    await expect(toggleBtn).toContainText('Show chart');

    const table = tokenCard.locator('.token-data-table');
    await expect(table).toBeVisible();
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(7);

    // Click Show chart to switch back
    await toggleBtn.click();
    await expect(tokenCard.locator('.token-bars-track')).toBeVisible();
    await expect(table).toBeHidden();
  });

  test('remains visible and readable at short viewport 1280x640', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 640 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });

    await referenceFixture(page);
    const { tasks, runs } = createMockTokenData();
    await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: tasks }));
    await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: runs }));
    await page.route(/\/api\/tasks\/t-tok-\d+\/runs$/, route => {
      const match = /t-tok-(\d+)/.exec(route.request().url());
      const taskId = match ? `t-tok-${match[1]}` : '';
      return route.fulfill({ json: runs.filter(r => r.taskId === taskId) });
    });

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const tokenCard = page.locator('.row3 [data-card-id="tokens"]');
    const chart = tokenCard.locator('.daily-token-chart');
    await expect(chart).toBeVisible();

    const box = await chart.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThan(80);

    const display = await chart.evaluate(el => getComputedStyle(el).display);
    expect(display).not.toBe('none');

    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: 'docs/images/redesign/dashboard-1280-light.png' });

    // Switch to dark mode and capture 1280x640 dark screenshot
    const themeBtn = page.getByRole('button', { name: /Theme|Giao diện/i }).first();
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: 'docs/images/redesign/dashboard-1280-dark.png' });
  });

  test('handles empty state (0 runs), unreported-only state, and error state with retry', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'vi');
      localStorage.setItem('fleet.theme', 'light');
    });

    await referenceFixture(page);

    // 1. Empty state: 0 tasks, 0 runs
    await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: [] }));
    await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: [] }));

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const tokenCard = page.locator('.row3 [data-card-id="tokens"]');
    await expect(tokenCard.locator('.token-chart-empty')).toBeVisible();
    const emptyCols = tokenCard.locator('.token-axis-col');
    await expect(emptyCols).toHaveCount(7);

    // Empty state vertical alignment check: col 0 vs col 6 (is-today)
    const emptyBar0 = await emptyCols.nth(0).locator('.token-bar-area').boundingBox();
    const emptyBar6 = await emptyCols.nth(6).locator('.token-bar-area').boundingBox();
    expect(emptyBar0).not.toBeNull();
    expect(emptyBar6).not.toBeNull();
    expect(Math.abs(emptyBar6!.y - emptyBar0!.y)).toBeLessThanOrEqual(0.5);

    // 2. Unreported-only state: runs exist but token counts are null
    const unreportedTask: Task = {
      id: 't-unrep-1',
      planId: 'p-reference',
      title: 'Unreported task',
      agent: 'qodercli',
      status: 'done',
      branch: 'fleet/unrep',
      worktreePath: 'C:\\fixture\\unrep',
      checkCmd: null,
      createdAt: Date.now() - 3600_000,
      finishedAt: Date.now(),
    };
    const unreportedRun: Run = {
      id: 'r-unrep-1',
      taskId: 't-unrep-1',
      agent: 'qodercli',
      attempt: 1,
      brief: 'Unreported brief',
      note: null,
      status: 'done',
      pid: null,
      exitCode: 0,
      startedAt: Date.now() - 3600_000,
      endedAt: Date.now(),
      durationMs: 3600_000,
      checkPassed: true,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      finalMessage: null,
      errorCategory: null,
      sessionId: null,
    };

    await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: [unreportedTask] }));
    await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: [unreportedRun] }));
    await page.route(/\/api\/tasks\/t-unrep-1\/runs$/, route => route.fulfill({ json: [unreportedRun] }));

    await page.reload();
    await expect(tokenCard.locator('.token-chart-unreported')).toBeVisible();

    // 3. Error state with retry: /api/runs returns db_corrupt fatal error (status 503)
    let retryCalled = false;
    await page.route(/\/api\/runs(?:\?.*)?$/, route => {
      if (retryCalled) {
        return route.fulfill({ json: [unreportedRun] });
      }
      return route.fulfill({ status: 503, json: { error: 'db_corrupt', message: 'Database corrupted' } });
    });

    await page.reload();
    const errorBox = tokenCard.locator('.token-chart-error');
    await expect(errorBox).toBeVisible();
    const retryBtn = errorBox.locator('button');
    await expect(retryBtn).toBeVisible();

    retryCalled = true;
    await retryBtn.click();
    await expect(errorBox).toBeHidden();
  });

  test('verifies vertical alignment and no horizontal overflow across 3 viewports and 2 themes', async ({ page }) => {
    await referenceFixture(page);
    const { tasks, runs } = createMockTokenData();
    await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: tasks }));
    await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: runs }));
    await page.route(/\/api\/tasks\/t-tok-\d+\/runs$/, route => {
      const match = /t-tok-(\d+)/.exec(route.request().url());
      const taskId = match ? `t-tok-${match[1]}` : '';
      return route.fulfill({ json: runs.filter(r => r.taskId === taskId) });
    });

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const tokenCard = page.locator('.row3 [data-card-id="tokens"]');
    await expect(tokenCard).toBeVisible();

    const viewports = [
      { width: 375, height: 812 },
      { width: 768, height: 900 },
      { width: 1440, height: 900 },
    ];
    const themes = ['light', 'dark'] as const;
    const scratchDir = 'C:/Users/diang_w/.gemini/antigravity/brain/11d52d0f-c0b7-407b-90af-bd0e03ae36f7/scratch';

    for (const vp of viewports) {
      await page.setViewportSize(vp);
      for (const theme of themes) {
        await page.evaluate((th) => {
          document.documentElement.setAttribute('data-theme', th);
          try {
            localStorage.setItem('fleet.theme', th);
          } catch {
            /* ignore */
          }
        }, theme);

        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(100);

        // 1. Verify no horizontal overflow
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        expect(overflow).toBe(true);

        // 2. Verify all 7 .token-bar-area boxes have identical y coordinates and heights
        const cols = tokenCard.locator('.token-bar-col');
        await expect(cols).toHaveCount(7);
        const box0 = await cols.nth(0).locator('.token-bar-area').boundingBox();
        const weekday0 = await cols.nth(0).locator('.weekday').boundingBox();
        expect(box0).not.toBeNull();
        expect(weekday0).not.toBeNull();

        for (let i = 1; i < 7; i++) {
          const boxI = await cols.nth(i).locator('.token-bar-area').boundingBox();
          const weekdayI = await cols.nth(i).locator('.weekday').boundingBox();
          expect(boxI).not.toBeNull();
          expect(weekdayI).not.toBeNull();
          expect(Math.abs(boxI!.y - box0!.y)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(boxI!.height - box0!.height)).toBeLessThanOrEqual(0.5);
          expect(Math.abs(weekdayI!.y - weekday0!.y)).toBeLessThanOrEqual(0.5);
        }

        // 3. Save screenshots to scratch directory
        await tokenCard.screenshot({ path: `${scratchDir}/token-chart-${vp.width}x${vp.height}-${theme}.png` });
        await page.screenshot({ path: `${scratchDir}/dashboard-${vp.width}x${vp.height}-${theme}.png` });
      }
    }
  });
});
