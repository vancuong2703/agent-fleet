import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './nav-helpers.js';

/**
 * Terminal page layout: the terminal fills the window, the top edge is compact,
 * the side column is resizable/collapsible and the status reads the live socket.
 */

const shots = 'test-results/terminal-layout';
const sizes = [{ width: 1440, height: 900 }, { width: 1874, height: 914 }, { width: 1280, height: 640 }];
const host = '.terminal-session:not([hidden]) .terminal-host';

async function setup(page: Page, options: { connected?: boolean; language?: 'en' | 'vi' } = {}) {
  const tools = ['codex', 'agy'].map(agent => ({ agent, title: agent === 'codex' ? 'Codex' : 'Antigravity (AGY)', installed: true, configuredBin: null, lastCheck: null, suggestions: [{ id: `${agent}-status`, label: 'Status', command: '/status', context: 'interactive', description: 'Read CLI status.' }, { id: `${agent}-help`, label: 'Help', command: '/help', context: 'interactive', description: 'Help.' }] }));
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: Date.now(), tools, terminalSessions: [] } }));
  await page.route('**/api/terminal-sessions', route => { const { agent } = route.request().postDataJSON(); return route.fulfill({ json: { id: `session-${agent}`, agent, title: `${agent} workspace`, cwd: 'C:\\Users\\someone\\projects\\a-rather-long-directory-name\\nested\\deeper\\workspace', source: 'workspace', planId: null, taskId: null, createdAt: Date.now(), connected: options.connected ?? true, reconnectGraceMs: 300000 } }); });
  const state = { connections: 0, messages: [] as Array<{ t: string; cols?: number; rows?: number }> };
  await page.routeWebSocket('**/ws/terminal?**', socket => {
    state.connections++;
    socket.onMessage(message => state.messages.push(JSON.parse(String(message))));
    socket.send(JSON.stringify({ t: 'out', d: 'terminal ready\r\n' }));
  });
  if (options.language) await page.addInitScript(language => { try { localStorage.setItem('fleet.language', language); } catch { /* ignore */ } }, options.language);
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  return state;
}

async function openCodex(page: Page, name: RegExp = /Mở Codex|Open Codex/) {
  await page.getByRole('button', { name }).click();
  await expect(page.locator('.terminal-connection.on')).toBeVisible();
}

const metrics = (page: Page) => page.evaluate((selector) => {
  const wrap = document.querySelector('.terminal-page') as HTMLElement;
  const box = document.querySelector(selector)!.getBoundingClientRect();
  const side = document.querySelector('.terminal-side')?.getBoundingClientRect();
  return { host: { w: Math.round(box.width), h: Math.round(box.height), top: Math.round(box.top), bottom: Math.round(box.bottom) }, side: side ? Math.round(side.width) : 0, scrollHeight: wrap.scrollHeight, clientHeight: wrap.clientHeight, innerHeight, hscroll: document.documentElement.scrollWidth > innerWidth };
}, host);

for (const size of sizes) {
  test(`terminal fills the window without a page scrollbar at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await setup(page); await openCodex(page);
    const m = await metrics(page);
    console.log(`MEASURE ${size.width}x${size.height} ${JSON.stringify(m)}`);
    expect(m.scrollHeight, JSON.stringify(m)).toBeLessThanOrEqual(m.clientHeight + 1);
    expect(m.host.top, `pixels above the terminal ${JSON.stringify(m)}`).toBeLessThanOrEqual(175);
    expect(m.innerHeight - m.host.bottom, `gap under the terminal ${JSON.stringify(m)}`).toBeLessThanOrEqual(48);
    expect(m.host.h, JSON.stringify(m)).toBeGreaterThanOrEqual(size.height - 175 - 48);
    expect(m.side, JSON.stringify(m)).toBe(280);
    expect(m.host.w, JSON.stringify(m)).toBeGreaterThan(m.side * 2);
  });
}

test('title, tabs, new session and count share one compact row at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  const rows = await page.evaluate(() => ['.terminal-page .title', '.terminal-page [role=tablist]', '.terminal-page .newbtn', '.terminal-page .stamp'].map(selector => { const box = document.querySelector(selector)!.getBoundingClientRect(); return { selector, mid: box.top + box.height / 2 }; }));
  const mids = rows.map(row => row.mid);
  expect(Math.max(...mids) - Math.min(...mids), JSON.stringify(rows)).toBeLessThan(24);
});

test('one dark toolbar row holds every control and the hint paragraph is gone', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  const panel = page.locator('.terminal-session:not([hidden])');
  await expect(panel.locator('.hint')).toHaveCount(0);
  const mids = await panel.evaluate(root => {
    const scope = root.querySelector('.terminal-panel')!;
    const items = [scope.querySelector('.terminal-connection'), scope.querySelector('.terminal-head input'), ...['Sao chép', 'Dán', 'Ẩn terminal', 'Kết thúc tiến trình'].map(name => [...scope.querySelectorAll('button')].find(button => button.textContent?.trim() === name))];
    return items.map(item => { if (!item) return null; const box = item.getBoundingClientRect(); return box.top + box.height / 2; });
  });
  expect(mids.every(value => value !== null), JSON.stringify(mids)).toBe(true);
  expect(Math.max(...(mids as number[])) - Math.min(...(mids as number[])), JSON.stringify(mids)).toBeLessThan(12);
  const bg = await panel.locator('.terminal-head').evaluate(el => getComputedStyle(el).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g)!.map(Number); expect(r + g + b, bg).toBeLessThan(150);
  await expect(panel.getByRole('button', { name: 'Kết thúc tiến trình', exact: true })).toHaveAttribute('title', /.+/);
  await expect(panel.getByRole('button', { name: 'Ẩn terminal', exact: true })).toHaveAttribute('title', /.+/);
  // Hiding still offers a way back.
  await panel.getByRole('button', { name: 'Ẩn terminal', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Hiện terminal', exact: true })).toBeVisible();
});

test('divider drags, uses the keyboard, resets on double click and persists', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  const divider = page.locator('.terminal-grid').getByRole('separator');
  await expect(divider).toHaveAttribute('aria-valuenow', '280');
  const box = (await divider.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(4);
  const before = await metrics(page);
  await page.mouse.move(box.x + box.width / 2, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x - 60, box.y + 200, { steps: 6 }); await page.mouse.up();
  const dragged = await metrics(page);
  expect(dragged.side).toBeGreaterThan(before.side + 40);
  expect(dragged.host.w).toBeLessThan(before.host.w - 40);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fleet.terminal.sideWidth'))).toBe(String(dragged.side));
  await divider.focus(); await page.keyboard.press('ArrowRight');
  expect((await metrics(page)).side).toBe(dragged.side - 16);
  await page.keyboard.press('End'); expect((await metrics(page)).side).toBeLessThanOrEqual(520);
  await page.keyboard.press('Home'); expect((await metrics(page)).side).toBe(220);
  await divider.dblclick(); expect((await metrics(page)).side).toBe(280);
  await page.keyboard.press('ArrowLeft'); await page.reload();
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await expect(page.locator('.terminal-side')).toBeVisible();
});

test('side column collapses to give the terminal the full width and restores', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  const before = await metrics(page);
  await page.getByRole('button', { name: /Ẩn cột thông tin/ }).click();
  const collapsed = await metrics(page);
  expect(collapsed.side).toBe(0);
  expect(collapsed.host.w).toBeGreaterThan(before.host.w + 250);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fleet.terminal.sideCollapsed'))).toBe('1');
  await page.getByRole('button', { name: /Hiện cột thông tin/ }).click();
  expect((await metrics(page)).side).toBe(280);
});

test('a stored width is clamped on a small window', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.setItem('fleet.terminal.sideWidth', '900'); } catch { /* ignore */ } });
  await page.setViewportSize({ width: 1180, height: 700 });
  await setup(page); await openCodex(page);
  const m = await metrics(page);
  expect(m.side, JSON.stringify(m)).toBeLessThanOrEqual(520);
  expect(m.side, JSON.stringify(m)).toBeLessThanOrEqual(Math.round(1180 * 0.45));
  expect(m.host.w, JSON.stringify(m)).toBeGreaterThan(400);
});

test('dragging refits the terminal but the PTY gets a debounced resize', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page); await openCodex(page);
  await expect.poll(() => state.messages.filter(m => m.t === 'resize').length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(400);
  const before = state.messages.filter(m => m.t === 'resize').length;
  const box = (await page.locator('.terminal-grid').getByRole('separator').boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 200); await page.mouse.down();
  for (let step = 1; step <= 24; step++) { await page.mouse.move(box.x + 2 - step * 6, box.y + 200); await page.waitForTimeout(16); }
  await page.mouse.up();
  const during = state.messages.filter(m => m.t === 'resize').length - before;
  expect(during, 'resize messages while dragging').toBeLessThanOrEqual(1);
  await expect.poll(() => state.messages.filter(m => m.t === 'resize').length - before, { timeout: 2000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(400);
  expect(state.messages.filter(m => m.t === 'resize').length - before).toBeLessThanOrEqual(2);
});

test('status and tab dot follow the live socket even when the snapshot says connecting', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { connected: false }); await openCodex(page);
  await expect(page.locator('.terminal-side .kv')).toContainText('Đã kết nối');
  await expect(page.locator('.terminal-side .kv')).not.toContainText('Đang kết nối');
  await expect(page.getByRole('tab').locator('.dot')).not.toHaveClass(/warn/);
  await expect(page.locator('.terminal-side h4').first()).toContainText('Đang chạy');
});

test('the session count is singular in English', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page, { language: 'en' }); await openCodex(page, /Open Codex/);
  await expect(page.locator('.terminal-page .stamp')).toHaveText('1 session');
});

test('working dir is one ellipsised line with the full path in a title and a copy button', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  const value = page.locator('.terminal-side .cwd-value');
  await expect(value).toHaveAttribute('title', /a-rather-long-directory-name/);
  expect(await value.evaluate(el => ({ one: el.getBoundingClientRect().height < 24, clipped: el.scrollWidth >= el.clientWidth }))).toEqual({ one: true, clipped: true });
  await expect(page.locator('.terminal-side').getByRole('button', { name: /Sao chép thư mục/ })).toBeVisible();
});

test('at 1100px and below it stacks: terminal first, usable height, no divider, no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await setup(page); await openCodex(page);
  const m = await page.evaluate((selector) => { const h = document.querySelector(selector)!.getBoundingClientRect(); const side = document.querySelector('.terminal-side')!.getBoundingClientRect(); const sep = document.querySelector('.terminal-grid [role=separator]'); return { hostH: h.height, hostTop: h.top, sideTop: side.top, sep: sep ? getComputedStyle(sep).display : 'none', hscroll: document.documentElement.scrollWidth > innerWidth, innerHeight }; }, host);
  expect(m.hostH, JSON.stringify(m)).toBeGreaterThanOrEqual(m.innerHeight * 0.5);
  expect(m.sideTop, JSON.stringify(m)).toBeGreaterThan(m.hostTop + m.hostH - 1);
  expect(m.sep).toBe('none'); expect(m.hscroll).toBe(false);
});

test('the New session picker does not squash the terminal for good', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  const before = await metrics(page);
  await page.getByRole('button', { name: 'Phiên mới', exact: true }).click();
  await expect(page.locator('.session-picker')).toBeVisible();
  await page.getByRole('button', { name: 'Phiên mới', exact: true }).click();
  await expect(page.locator('.session-picker')).toHaveCount(0);
  const after = await metrics(page);
  expect(Math.abs(after.host.h - before.host.h)).toBeLessThanOrEqual(2);
  expect(after.scrollHeight).toBeLessThanOrEqual(after.clientHeight + 1);
});

test('screenshots at 375, 768 and 1440 in both themes without horizontal overflow', async ({ page }) => {
  await mkdir(shots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 800 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width} ${theme}`).toBe(true);
      await page.screenshot({ path: `${shots}/${width}-${theme}.png` });
    }
  }
  await setTheme(page, 'light');
  await page.setViewportSize({ width: 1440, height: 900 });
  const divider = page.locator('.terminal-grid').getByRole('separator');
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x - 120, box.y + 200, { steps: 6 }); await page.mouse.up();
  await page.screenshot({ path: `${shots}/1440-dragged.png` });
  await page.getByRole('button', { name: /Ẩn cột thông tin/ }).click();
  await page.screenshot({ path: `${shots}/1440-collapsed.png` });
});

test('session tab row has no stray vertical scrollbar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page); await openCodex(page);
  await page.getByRole('tab').first().focus();
  const m = await page.locator('.terminal-top .sessions').evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight, overflowY: getComputedStyle(el).overflowY }));
  expect(m.sh, JSON.stringify(m)).toBeLessThanOrEqual(m.ch);
});
