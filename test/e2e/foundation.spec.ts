import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// Deliberately use synthetic API data: foundation checks never start an agent.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    const tools = [['codex', 'Codex'], ['qodercli', 'Qoder'], ['agy', 'Antigravity'], ['opencode', 'OpenCode']].map(([agent, title]) => ({ agent, title, installed: false, configuredBin: null, lastCheck: null, suggestions: [] }));
    return route.fulfill({ json: url.pathname === '/api/dashboard' ? { generatedAt: 0, tools, terminalSessions: [] } : [] });
  });
  await page.addInitScript(() => localStorage.setItem('fleet.layout', JSON.stringify({ sidebarWidth: 420, inspectorWidth: 320, terminalHeight: 380 })));
  const dataDir = process.env.FLEET_DATA_DIR;
  if (dataDir) {
    const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
    await page.goto('/auth?token=' + encodeURIComponent(token));
  } else await page.goto('/');
  await expect(page.locator('.tool-card')).toHaveCount(4);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`${theme} foundation fits ${width}px and preserves responsive sidebar`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const sizes = await page.evaluate(() => {
        const sidebar = document.querySelector('.workspace-sidebar')!;
        const dashboard = document.querySelector('.dashboard-host')!;
        return { sidebar: sidebar.getBoundingClientRect().width, page: document.documentElement.scrollWidth, viewport: innerWidth, dashboard: dashboard.scrollWidth, available: dashboard.clientWidth };
      });
      await page.screenshot({ path: testInfo.outputPath(`foundation-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
      // Check the scroll container as well; overflow:hidden on .app can mask clipping.
      expect(sizes.dashboard).toBeLessThanOrEqual(sizes.available);
      if (width === 768) expect(sizes.sidebar).toBe(224);
      if (width === 1440) expect(sizes.sidebar).toBe(420);
    });
  }
}

test('dark vendor chips keep dark logo pixels above 3:1 contrast', async ({ page }) => {
  await page.getByRole('button', { name: 'Giao diện tối', exact: true }).click();
  for (const agent of ['qodercli', 'opencode']) {
    const result = await page.locator(`.tool-heading .vendor-${agent}`).evaluate(async chip => {
      const img = chip.querySelector('img')!;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      const color = getComputedStyle(chip).backgroundColor;
      ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
      const bg = [...ctx.getImageData(0, 0, 1, 1).data];
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      let darkest = 1;
      for (let i = 0; i < pixels.length; i += 4) darkest = Math.min(darkest, luminance([...pixels.slice(i, i + 3)]));
      return { alpha: bg[3], contrast: (luminance(bg) + .05) / (darkest + .05) };
    });
    expect(result.alpha).toBe(255);
    expect(result.contrast).toBeGreaterThanOrEqual(3);
  }
});
