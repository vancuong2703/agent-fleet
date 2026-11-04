import { expect, type Page } from '@playwright/test';

/**
 * Shared navigation moves for the specs. The palette is the one control that
 * exists at every width, so theme switching and "new task" go through it instead
 * of the sidebar, which is a rail or a closed drawer below 900px.
 */

async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Ô lệnh nhanh' });
  await expect(palette).toBeVisible();
}

async function runPaletteCommand(page: Page, command: string): Promise<void> {
  await openPalette(page);
  await page.getByRole('combobox', { name: 'Tìm lệnh' }).fill(command);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Ô lệnh nhanh' })).toBeHidden();
}

export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await runPaletteCommand(page, theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối');
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

export async function openComposer(page: Page): Promise<void> {
  await runPaletteCommand(page, 'Tạo công việc mới');
  await expect(page.getByRole('dialog', { name: 'Giao một công việc mới' })).toBeVisible();
}
