import { expect, test, type Page } from '@playwright/test';
import { openJobs } from './jobs-fixture.js';

/** Draggable list | detail divider, the stray tab-row scrollbar and the one-line log kind column. */

const width = (page: Page, selector: string) => page.locator(selector).first().evaluate(el => Math.round(el.getBoundingClientRect().width));

async function drag(page: Page, dx: number) {
  const box = (await page.locator('.jobs-divider').boundingBox())!;
  const x = box.x + box.width / 2; const y = box.y + 120;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y, { steps: 6 }); await page.mouse.up();
}

test('default split keeps its proportion, then the divider drags, clamps, resets and persists', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 900 });
  const divider = page.locator('.jobs-divider');
  await expect(divider).toBeVisible();
  const list0 = await width(page, '.jobs-page .list'); const detail0 = await width(page, '.jobs-page .detail');
  expect(list0 / detail0, `${list0}/${detail0}`).toBeGreaterThan(1.1); expect(list0 / detail0).toBeLessThan(1.26);
  expect(await page.evaluate(() => localStorage.getItem('fleet.jobs.listWidth'))).toBeNull();

  await drag(page, -120);
  const list1 = await width(page, '.jobs-page .list');
  expect(list1).toBeLessThan(list0 - 80);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fleet.jobs.listWidth'))).toBe(String(list1));

  await divider.focus();
  await page.keyboard.press('Home'); expect(await width(page, '.jobs-page .list')).toBe(280);
  await page.keyboard.press('End'); expect(await width(page, '.jobs-page .detail')).toBe(360);
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  expect(await width(page, '.jobs-page .list')).toBe(296);

  await page.reload();
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await expect(page.locator('.jobs-page .rows tr').first()).toBeVisible();
  expect(await width(page, '.jobs-page .list')).toBe(296);

  await page.locator('.jobs-divider').dblclick();
  const reset = await width(page, '.jobs-page .list');
  expect(Math.abs(reset - list0)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => localStorage.getItem('fleet.jobs.listWidth'))).toBeNull();
});

test('a stored width is clamped when the window gets small and the divider hides when stacked', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('fleet.jobs.listWidth', '1000'); } catch { /* ignore */ } });
  await openJobs(page, { width: 1200, height: 800 });
  expect(await width(page, '.jobs-page .detail')).toBeGreaterThanOrEqual(360);
  expect(await width(page, '.jobs-page .list')).toBeGreaterThanOrEqual(280);
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(page.locator('.jobs-divider')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('expand hides the divider and shrinking brings back the dragged width and scroll positions', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 800 });
  await drag(page, -100);
  const dragged = await width(page, '.jobs-page .list');
  const list = page.locator('.jobs-page .list .tablewrap'); const log = page.locator('.log-scroll');
  await list.evaluate(el => { el.scrollTop = 90; }); await log.evaluate(el => { el.scrollTop = 700; });
  await page.locator('.jobs-page .zoom-toggle').click();
  await expect(page.locator('.jobs-page .split')).toHaveClass(/zoom/);
  await expect(page.locator('.jobs-divider')).toHaveCount(0);
  expect(await width(page, '.jobs-page .list')).toBeLessThanOrEqual(240);
  await page.keyboard.press('Escape');
  await expect(page.locator('.jobs-divider')).toBeVisible();
  expect(await width(page, '.jobs-page .list')).toBe(dragged);
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(90);
  await expect.poll(() => log.evaluate(el => el.scrollTop)).toBe(700);
});

test('tab rows have no stray vertical scrollbar', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 900 });
  await page.locator('.jobs-page .jtabs [role=tab]').first().focus();
  const m = await page.locator('.jobs-page .jtabs').evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, oh: (el as HTMLElement).offsetHeight, overflowY: getComputedStyle(el).overflowY }));
  expect(m.sh, JSON.stringify(m)).toBeLessThanOrEqual(m.ch);
  expect(m.oh - m.ch, `scrollbar width ${JSON.stringify(m)}`).toBeLessThanOrEqual(0);
});

test('log kind labels stay on one line', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 900 }, { events: 12 });
  // Real rows only show some kinds; render every label with the production classes in the real log container.
  const kinds = await page.locator('.log-scroll').first().evaluate(scroll => {
    const labels = ['Tin nhắn', 'Lệnh', 'Sửa tệp', 'Công cụ', 'Mức sử dụng', 'Phiên', 'Lỗi', 'Dữ liệu thô', 'Trạng thái', 'Kiểm tra'];
    const holder = document.createElement('div'); scroll.appendChild(holder);
    const out = labels.map(label => {
      holder.innerHTML = `<div class="log-line"><span class="log-ts">10:00:00</span><span class="log-kind">${label}</span><span class="log-text">text</span></div>`;
      const el = holder.querySelector('.log-kind') as HTMLElement; const h = Math.round(el.getBoundingClientRect().height); const box = Math.round(el.getBoundingClientRect().width);
      const saved = el.style.cssText; el.style.cssText = 'white-space:nowrap;width:max-content;overflow:visible;'; const natural = Math.ceil(el.getBoundingClientRect().width); el.style.cssText = saved;
      const line = holder.firstElementChild!.getBoundingClientRect().height;
      return { label, h, box, natural, line: Math.round(line) };
    });
    holder.remove(); return out;
  });
  for (const kind of kinds) { expect(kind.natural, JSON.stringify(kind)).toBeLessThanOrEqual(kind.box); expect(kind.h, JSON.stringify(kind)).toBeLessThan(24); expect(kind.line, JSON.stringify(kind)).toBeLessThan(24); }
  const text = await page.locator('.log-text').first().evaluate(el => el.getBoundingClientRect().width);
  expect(text).toBeGreaterThan(200);
});
