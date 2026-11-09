import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { ConnectedClient } from '../../shared/connections.js';
import { setTheme } from './nav-helpers.js';

const MOCK_CLIENTS: ConnectedClient[] = [
  {
    id: 'conn-agy-1',
    toolId: 'agy',
    toolName: 'Antigravity CLI',
    pid: 12345,
    cwd: 'C:\\repos\\my-project',
    lastCommand: 'fleet connection',
    connectedAt: Date.now() - 60_000,
    lastSeenAt: Date.now() - 15_000,
    requestCount: 5,
  },
  {
    id: 'conn-codex-1',
    toolId: 'codex',
    toolName: 'Codex CLI',
    pid: 67890,
    cwd: 'C:\\repos\\agent-fleet',
    lastCommand: 'fleet connection',
    connectedAt: Date.now() - 120_000,
    lastSeenAt: Date.now() - 25_000,
    requestCount: 12,
  },
];

async function navigateToConnections(page: Page): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Tìm lệnh' }).fill('Công cụ kết nối');
  await page.keyboard.press('Enter');
  await expect(page.locator('.connections-page')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/connections', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_CLIENTS),
    });
  });

  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
});

test('navigates to connected tools screen and displays active tools with details', async ({ page }) => {
  await navigateToConnections(page);

  await expect(page.getByRole('heading', { name: 'Công cụ kết nối' })).toBeVisible();

  const agyCard = page.locator('.conn-card').filter({ hasText: 'Antigravity CLI' });
  await expect(agyCard).toBeVisible();
  await expect(agyCard.locator('.badge.ok')).toHaveText('Đang kết nối');
  await expect(agyCard.locator('.conn-cmd')).toHaveText('fleet connection');
  await expect(agyCard.locator('.conn-cwd')).toHaveText('C:\\repos\\my-project');
  await expect(agyCard).toContainText('PID 12345');
  await expect(agyCard).toContainText('5 lệnh');

  const codexCard = page.locator('.conn-card').filter({ hasText: 'Codex CLI' });
  await expect(codexCard).toBeVisible();
  await expect(codexCard.locator('.badge.ok')).toHaveText('Đang kết nối');
  await expect(codexCard.locator('.conn-cmd')).toHaveText('fleet connection');
  await expect(codexCard.locator('.conn-cwd')).toHaveText('C:\\repos\\agent-fleet');
  await expect(codexCard).toContainText('PID 67890');
  await expect(codexCard).toContainText('12 lệnh');
});

for (const theme of ['light', 'dark'] as const) {
  test(`connected tools screen fits 375/768/1440 in ${theme} without horizontal overflow`, async ({ page }) => {
    await navigateToConnections(page);
    await setTheme(page, theme);

    const scratchDir = 'C:/Users/diang_w/.gemini/antigravity/brain/e40a61d0-d095-4ca5-8a4f-8dc3f2d1fae0/scratch';

    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);

      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(noOverflow, `Expected no horizontal overflow at width ${width}px in ${theme} theme`).toBe(true);

      const screenshotPath = `${scratchDir}/connections-${width}-${theme}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
    }
  });
}
