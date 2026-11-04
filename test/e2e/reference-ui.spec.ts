import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { referenceFixture } from './reference-fixture.js';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1874, height: 914 });
  await page.addInitScript(() => { localStorage.setItem('fleet.language', 'en'); localStorage.setItem('fleet.theme', 'light'); });
  await referenceFixture(page);
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
});

test('the app uses the OpenCode navigation shell and compare composition', async ({ page }) => {
  const side = page.getByRole('complementary', { name: 'Navigation' });
  await expect(side).toBeVisible();
  expect(Math.round((await side.boundingBox())!.width)).toBe(212);
  await expect(side.locator('.task-row,.sidebar-search,.new-task-button')).toHaveCount(0);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await expect(page.locator('.cmp > .card')).toHaveCount(4);
  await expect(page.locator('.summary table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hardware', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.topbar .status-chips,.statusbar,.workspace-sidebar .sidebar')).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/images/redesign/compare-1874-light.png' });
});

test('jobs use a table and adjacent detail panel instead of sidebar task navigation', async ({ page }) => {
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await expect(page.locator('.jobs-page .split .list')).toBeVisible();
  await expect(page.locator('.jobs-page .split .detail')).toBeVisible();
  await expect(page.getByRole('button', { name: 'New job', exact: true })).toBeVisible();
});

test('the log zoom narrows the job list and widens the detail', async ({ page }) => {
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  const split = page.locator('.jobs-page .split');
  const list = page.locator('.jobs-page .split .list');
  const detail = page.locator('.jobs-page .split .detail');
  const toggle = page.locator('.jobs-page .zoom-toggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  const before = { list: Math.round((await list.boundingBox())!.width), detail: Math.round((await detail.boundingBox())!.width) };
  await toggle.click();
  await expect(split).toHaveClass(/zoom/);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const after = { list: Math.round((await list.boundingBox())!.width), detail: Math.round((await detail.boundingBox())!.width) };
  expect(after.list).toBeLessThan(before.list);
  expect(after.detail).toBeGreaterThan(before.detail);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'docs/images/redesign/tasks-zoom-1440-light.png' });
  await toggle.click();
  await expect(split).not.toHaveClass(/zoom/);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`all rebuilt pages fit ${width}px in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 940 });
      if (theme === 'dark') await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      for (const [view, nav] of [['dashboard', 'Dashboard'], ['tasks', 'Jobs'], ['compare', 'Compare'], ['usage', 'Resources & usage'], ['terminal', 'Terminal'], ['guide', 'Leader guide']] as const) {
        if (width <= 900) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
        await page.getByRole('button', { name: nav, exact: true }).click();
        const screen = page.locator(`[data-page="${view}"]`);
        await expect(screen).toBeVisible();
        // A ring label must sit inside the ring: a decimal like "45.9%" runs
        // over the stroke at both 80 px and 56 px, so the label is a whole
        // percent and this guard keeps it that way.
        const rings = await page.evaluate(selector => [...document.querySelectorAll(selector)].map(el => {
          const pct = el.querySelector('.pct');
          if (!pct) return null;
          const size = el.getBoundingClientRect().width;
          if (size === 0) return null;
          const range = document.createRange(); range.selectNodeContents(pct);
          return { text: pct.textContent ?? '', label: Math.ceil(range.getBoundingClientRect().width), inner: Math.floor(size * 24 / 44) };
        }).filter((value): value is { text: string; label: number; inner: number } => value !== null), `[data-page="${view}"] .donut`);
        expect(rings.filter(ring => ring.label > ring.inner - 2), `${view} ring label overflow: ${JSON.stringify(rings)}`).toEqual([]);
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, topbar: document.querySelector('.topbar')!.getBoundingClientRect().right }));
        expect(geometry.document, `${view}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(width);
        expect(geometry.topbar).toBeLessThanOrEqual(width + 1);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: `docs/images/redesign/${view}-${width}-${theme}.png` });
      }
    });
  }
}
