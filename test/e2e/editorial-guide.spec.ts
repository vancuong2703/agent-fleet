import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './nav-helpers.js';

async function navigate(page: Page, label: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Tìm lệnh' }).fill(label);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
});

test('reference shell keeps warm/plain preferences and does not replace the app when cycling styles', async ({ page }) => {
  await expect(page.locator('.dashboard-page .zones > .card')).toHaveCount(4);
  const initial = await page.locator('html').getAttribute('data-style');
  await page.getByRole('button', { name: 'Sắc độ giao diện', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-style', initial === 'plain' ? 'warm' : 'plain');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-style', initial === 'plain' ? 'warm' : 'plain');
  await expect(page.locator('.dashboard-page .zones > .card')).toHaveCount(4);
});

test('leader guide previews and copies the current connection, handles clipboard errors', async ({ page, context }) => {
  await navigate(page, 'Hướng dẫn leader');
  const preview = page.getByRole('textbox', { name: 'Nội dung gửi cho leader' });
  await expect(preview).toHaveValue(/FLEET_DATA_DIR/);
  await expect(preview).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${process.env.FLEET_E2E_PORT}`));
  await expect(preview).toHaveValue(/function fleet/);
  await expect(preview).toHaveValue(/Checklist trước khi merge/);
  const text = await preview.inputValue();
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  expect(text).not.toContain(token);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Sao chép gửi hội thoại', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Đã sao chép' })).toBeVisible();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n')).toBe(text.replaceAll('\r\n', '\n'));
  await page.getByRole('button', { name: 'Sao chép lệnh kết nối', exact: true }).click();
  const connect = await page.evaluate(() => navigator.clipboard.readText());
  expect(connect).toContain('function fleet');
  expect(connect).toContain('FLEET_DATA_DIR');
  expect(connect).not.toContain('Checklist trước khi merge');
  expect(connect).not.toContain(token);
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('blocked')) }); });
  await page.getByRole('button', { name: 'Sao chép gửi hội thoại', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Chọn nội dung');
  await expect(preview).toBeFocused();
});

test('leader guide exposes loading and retryable errors before rendering connection content', async ({ page }) => {
  let fail = true;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/leader-guide', async route => {
    if (fail) { await gate; return route.fulfill({ status: 500, json: { message: 'Synthetic guide read failure' } }); }
    return route.fallback();
  });
  await navigate(page, 'Hướng dẫn leader');
  await expect(page.getByRole('status')).toContainText('Đang tải hướng dẫn kết nối');
  await expect(page.getByRole('button', { name: 'Sao chép gửi hội thoại', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('Synthetic guide read failure');
  fail = false;
  await page.getByRole('alert').getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Nội dung gửi cho leader' })).toHaveValue(/function fleet/);
  await expect(page.getByRole('button', { name: 'Sao chép gửi hội thoại', exact: true })).toBeEnabled();
});

for (const theme of ['light', 'dark'] as const) {
  test(`guide and editorial controls fit 375/768/1440 in ${theme}`, async ({ page }, testInfo) => {
    await navigate(page, 'Hướng dẫn leader');
    await setTheme(page, theme);
    await expect(page.getByRole('textbox', { name: 'Nội dung gửi cho leader' })).not.toBeEmpty();
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.getByRole('button', { name: 'Sao chép gửi hội thoại', exact: true })).toBeInViewport();
      const dimensions = await page.locator('.guide-page').evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1);
      await page.screenshot({ path: testInfo.outputPath(`guide-${width}-${theme}.png`) });
    }
  });
}
