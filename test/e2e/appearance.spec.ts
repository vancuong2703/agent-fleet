import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { referenceFixture } from './reference-fixture.js';

test.describe('Appearance preferences and defaults', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await referenceFixture(page);
  });

  test('a fresh profile defaults to plain white surface, system font, standard size, and system motion', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('fleet.appearance');
      localStorage.removeItem('fleet.view-style');
      localStorage.removeItem('fleet.theme');
    });
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(html).toHaveAttribute('data-style', 'plain');
    await expect(html).toHaveAttribute('data-font', 'system');
    await expect(html).toHaveAttribute('data-size', 'standard');
    await expect(html).toHaveAttribute('data-motion', 'system');

    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bodyBg).toBe('rgb(255, 255, 255)');
  });

  test('opening appearance popover allows switching preferences and persists across reload', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const trigger = page.locator('.appearance-trigger');
    await expect(trigger).toBeVisible();
    await trigger.click();

    const popover = page.locator('.appearance-popover');
    await expect(popover).toBeVisible();

    const html = page.locator('html');

    // Test style switching
    await popover.getByRole('button', { name: /Warm paper|Giấy ấm/i }).click();
    await expect(html).toHaveAttribute('data-style', 'warm');

    await popover.getByRole('button', { name: /White \(default\)|Trắng \(mặc định\)/i }).click();
    await expect(html).toHaveAttribute('data-style', 'plain');

    // Test font switching
    await popover.getByRole('button', { name: 'Inter' }).click();
    await expect(html).toHaveAttribute('data-font', 'inter');

    await popover.getByRole('button', { name: 'Bricolage' }).click();
    await expect(html).toHaveAttribute('data-font', 'bricolage');

    await popover.getByRole('button', { name: 'Segoe UI' }).click();
    await expect(html).toHaveAttribute('data-font', 'system');

    // Test size switching
    await popover.getByRole('button', { name: /Comfortable|Rộng rãi/i }).click();
    await expect(html).toHaveAttribute('data-size', 'large');

    await popover.getByRole('button', { name: /Standard|Tiêu chuẩn/i }).click();
    await expect(html).toHaveAttribute('data-size', 'standard');

    // Test motion switching
    await popover.getByRole('button', { name: /Reduced|Giảm chuyển động/i }).click();
    await expect(html).toHaveAttribute('data-motion', 'reduced');

    await popover.getByRole('button', { name: /^Off$|^Tắt$/i }).click();
    await expect(html).toHaveAttribute('data-motion', 'off');

    await popover.getByRole('button', { name: /System|Theo hệ thống/i }).click();
    await expect(html).toHaveAttribute('data-motion', 'system');

    // Set non-defaults and reload to test persistence
    await popover.getByRole('button', { name: /Warm paper|Giấy ấm/i }).click();
    await popover.getByRole('button', { name: 'Bricolage' }).click();
    await popover.getByRole('button', { name: /Comfortable|Rộng rãi/i }).click();
    await popover.getByRole('button', { name: /Reduced|Giảm chuyển động/i }).click();

    await page.reload();

    await expect(html).toHaveAttribute('data-style', 'warm');
    await expect(html).toHaveAttribute('data-font', 'bricolage');
    await expect(html).toHaveAttribute('data-size', 'large');
    await expect(html).toHaveAttribute('data-motion', 'reduced');
  });

  test('dark mode disables light surface buttons and preserves preference when switching back', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const trigger = page.locator('.appearance-trigger');
    await trigger.click();
    const popover = page.locator('.appearance-popover');
    await expect(popover).toBeVisible();

    // Select warm paper first
    await popover.getByRole('button', { name: /Warm paper|Giấy ấm/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-style', 'warm');

    // Close popover
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // Switch to Dark mode via topbar theme button
    const themeBtn = page.getByRole('button', { name: /Theme|Giao diện/i }).first();
    await themeBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Open Appearance popover again
    await trigger.click();
    await expect(popover).toBeVisible();

    const whiteBtn = popover.getByRole('button', { name: /White \(default\)|Trắng \(mặc định\)/i });
    const warmBtn = popover.getByRole('button', { name: /Warm paper|Giấy ấm/i });
    await expect(whiteBtn).toBeDisabled();
    await expect(warmBtn).toBeDisabled();

    const note = popover.locator('.appearance-note');
    await expect(note).toBeVisible();

    // Close popover and switch back to Light mode
    await page.keyboard.press('Escape');
    // In Workspace.tsx, theme cycle is: light -> dark -> system -> light
    // So click twice to return to light mode
    await themeBtn.click(); // to system
    if (await page.locator('html').getAttribute('data-theme') !== 'light') {
      await themeBtn.click(); // to light
    }
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Verify warm style preference was preserved
    await expect(page.locator('html')).toHaveAttribute('data-style', 'warm');

    // Open popover and verify buttons are enabled again
    await trigger.click();
    await expect(popover).toBeVisible();
    await expect(whiteBtn).toBeEnabled();
    await expect(warmBtn).toBeEnabled();
  });

  test('reset to default restores appearance without wiping theme or language', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'vi');
      localStorage.setItem('fleet.theme', 'light');
    });
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const trigger = page.locator('.appearance-trigger');
    await trigger.click();
    const popover = page.locator('.appearance-popover');
    await expect(popover).toBeVisible();

    // Change several settings
    await popover.getByRole('button', { name: /Giấy ấm|Warm paper/i }).click();
    await popover.getByRole('button', { name: 'Inter' }).click();
    await popover.getByRole('button', { name: /Rộng rãi|Comfortable/i }).click();
    await popover.getByRole('button', { name: /Tắt|^Off$/i }).click();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-style', 'warm');
    await expect(html).toHaveAttribute('data-font', 'inter');
    await expect(html).toHaveAttribute('data-size', 'large');
    await expect(html).toHaveAttribute('data-motion', 'off');

    // Click Reset
    const resetBtn = popover.locator('.appearance-reset');
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // Verify reset values
    await expect(html).toHaveAttribute('data-style', 'plain');
    await expect(html).toHaveAttribute('data-font', 'system');
    await expect(html).toHaveAttribute('data-size', 'standard');
    await expect(html).toHaveAttribute('data-motion', 'system');

    // Verify language and theme are unchanged
    const lang = await page.evaluate(() => localStorage.getItem('fleet.language'));
    const theme = await page.evaluate(() => localStorage.getItem('fleet.theme'));
    expect(lang).toBe('vi');
    expect(theme).toBe('light');
  });

  test('Escape and outside click close the appearance popover and restore focus', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const trigger = page.locator('.appearance-trigger');
    await trigger.click();
    const popover = page.locator('.appearance-popover');
    await expect(popover).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();

    // Reopen and click outside
    await trigger.click();
    await expect(popover).toBeVisible();
    await page.locator('.crumb').click({ force: true });
    await expect(popover).toBeHidden();
  });
});
