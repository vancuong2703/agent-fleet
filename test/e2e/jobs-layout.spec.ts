import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { mockLongJobs, openJobs } from './jobs-fixture.js';
import { referenceFixture } from './reference-fixture.js';

/**
 * Regression tests for the Jobs layout: a very long log used to stretch the
 * split (and the job rows) to the log's height, so `.wrap` scrolled and carried
 * the header, filters and search out of view.
 */

const sizes = [{ width: 1440, height: 900 }, { width: 1874, height: 914 }, { width: 1280, height: 640 }];

for (const size of sizes) {
  test(`a long log does not stretch the page or the rows at ${size.width}x${size.height}`, async ({ page }) => {
    await openJobs(page, size);
    const metrics = await page.evaluate(() => {
      const wrap = document.querySelector('.wrap.jobs-page') as HTMLElement;
      const inView = (selector: string) => { const box = document.querySelector(selector)!.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight && box.height > 0; };
      const rows = [...document.querySelectorAll('.jobs-page .rows tr')].map(row => Math.round(row.getBoundingClientRect().height));
      return { scrollTop: wrap.scrollTop, scrollHeight: wrap.scrollHeight, clientHeight: wrap.clientHeight, head: inView('.jobs-page .head'), filters: inView('.jobs-page .jbar, .jobs-page .head .filters'), search: inView('.job-search'), maxRow: Math.max(...rows), minRow: Math.min(...rows), splitHeight: document.querySelector('.jobs-page .split')!.getBoundingClientRect().height, innerHeight };
    });
    expect(metrics.scrollTop, JSON.stringify(metrics)).toBe(0);
    expect(metrics.scrollHeight, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.clientHeight + 1);
    expect(metrics.head && metrics.filters && metrics.search, JSON.stringify(metrics)).toBe(true);
    expect(metrics.maxRow, JSON.stringify(metrics)).toBeLessThanOrEqual(64);
    expect(metrics.splitHeight, JSON.stringify(metrics)).toBeLessThan(metrics.innerHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('list and log scroll independently and only one scroller owns the Log tab', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 700 });
  const list = page.locator('.jobs-page .list .tablewrap');
  const log = page.locator('.log-scroll');
  expect(await list.evaluate(el => el.scrollHeight > el.clientHeight), 'list scrolls').toBe(true);
  expect(await log.evaluate(el => el.scrollHeight > el.clientHeight), 'log scrolls').toBe(true);
  await log.evaluate(el => { el.scrollTop = 500; });
  await list.evaluate(el => { el.scrollTop = 120; });
  expect(await log.evaluate(el => el.scrollTop)).toBe(500);
  expect(await list.evaluate(el => el.scrollTop)).toBe(120);
  await log.evaluate(el => { el.scrollTop = 900; });
  expect(await list.evaluate(el => el.scrollTop)).toBe(120);
  // Exactly one element inside the detail panel actually scrolls on the Log tab.
  const scrollers = await page.evaluate(() => [...document.querySelectorAll('.jobs-page .detail *')].filter(el => { const style = getComputedStyle(el); return /(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1; }).map(el => el.className));
  expect(scrollers).toEqual(['log-scroll']);
  expect(await page.evaluate(() => (document.querySelector('.wrap.jobs-page') as HTMLElement).scrollTop)).toBe(0);
});

test('with the terminal open the tabs and a usable pane stay reachable in a short window', async ({ page }) => {
  await openJobs(page, { width: 1280, height: 640 });
  await page.locator('.jobs-page .rows tr', { hasText: 't-lay-101' }).click();
  await page.getByRole('button', { name: 'Open CLI', exact: true }).click();
  await expect(page.locator('.terminal-panel, .terminal-fill').first()).toBeVisible();
  const metrics = await page.evaluate(() => {
    const tabs = document.querySelector('.jobs-page .jtabs')!.getBoundingClientRect();
    const pane = document.querySelector('.jobs-page .panes')!.getBoundingClientRect();
    const wrap = document.querySelector('.wrap.jobs-page') as HTMLElement;
    return { tabsBottom: tabs.bottom, paneHeight: pane.height, paneBottom: pane.bottom, innerHeight, wrapScroll: wrap.scrollTop, over: wrap.scrollHeight - wrap.clientHeight };
  });
  expect(metrics.tabsBottom, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.paneHeight, JSON.stringify(metrics)).toBeGreaterThanOrEqual(160);
  expect(metrics.paneBottom, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.innerHeight);
  expect(metrics.over, JSON.stringify(metrics)).toBeLessThanOrEqual(1);
});

test('expanding hides the page head, filters and job meta, and shrinking restores scroll positions', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 800 });
  const list = page.locator('.jobs-page .list .tablewrap');
  const log = page.locator('.log-scroll');
  await list.evaluate(el => { el.scrollTop = 90; });
  await log.evaluate(el => { el.scrollTop = 700; });
  const normalPane = await page.locator('.jobs-page .panes').evaluate(el => el.getBoundingClientRect().height);
  const toggle = page.locator('.jobs-page .zoom-toggle');
  await toggle.click();
  await expect(page.locator('.jobs-page .split')).toHaveClass(/zoom/);
  await expect(page.locator('.jobs-page .head')).toBeHidden();
  await expect(page.locator('.jobs-page .jbar, .jobs-page .head .filters')).toBeHidden();
  await expect(page.locator('.jobs-page .jobmeta')).toBeHidden();
  await expect(page.locator('.jobs-page .list')).toBeVisible();
  const bigPane = await page.locator('.jobs-page .panes').evaluate(el => el.getBoundingClientRect().height);
  expect(bigPane).toBeGreaterThan(normalPane + 120);
  await page.keyboard.press('Escape');
  await expect(page.locator('.jobs-page .split')).not.toHaveClass(/zoom/);
  await expect(page.locator('.jobs-page .head')).toBeVisible();
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(90);
  await expect.poll(() => log.evaluate(el => el.scrollTop)).toBe(700);
});

// Screenshots for the review checklist (3 widths x 2 themes). Playwright wipes
// test-results at the start of every run, so run this file last when keeping them.
for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`jobs fit ${width}px in ${theme} with a long log and keep the head reachable`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 812 });
      await page.addInitScript(() => { localStorage.setItem('fleet.language', 'en'); localStorage.setItem('fleet.theme', 'light'); });
      await referenceFixture(page);
      await mockLongJobs(page, { diffFiles: 5 });
      const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
      await page.goto(`/auth?token=${encodeURIComponent(token)}`);
      if (theme === 'dark') await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      if (width <= 900) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
      await page.getByRole('button', { name: 'Jobs', exact: true }).click();
      await expect(page.locator('.jobs-page .rows tr')).toHaveCount(18);
      await expect(page.locator('.log-line').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, maxRow: Math.max(...[...document.querySelectorAll('.jobs-page .rows tr')].map(row => row.getBoundingClientRect().height)) }));
      expect(geometry.scrollWidth, JSON.stringify(geometry)).toBeLessThanOrEqual(geometry.innerWidth);
      expect(geometry.maxRow, JSON.stringify(geometry)).toBeLessThanOrEqual(90);
      await page.screenshot({ path: `test-results/jobs-layout/jobs-${width}-${theme}.png` });
      await page.getByRole('tab', { name: /Changes/ }).click();
      await expect(page.locator('.diff-section')).toHaveCount(5);
      await page.screenshot({ path: `test-results/jobs-layout/jobs-diff-${width}-${theme}.png` });
    });
  }
}
