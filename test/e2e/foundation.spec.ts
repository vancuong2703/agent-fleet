import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { setTheme } from './nav-helpers.js';

test.beforeEach(async ({ page }) => {
  const tools = [['codex', 'Codex'], ['qodercli', 'Qoder'], ['agy', 'Antigravity'], ['opencode', 'OpenCode']].map(([agent, title]) => ({ agent, title, installed: false, configuredBin: null, lastCheck: null, suggestions: [] }));
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: 0, tools, terminalSessions: [] } }));
  await page.route('**/api/plans', route => route.fulfill({ json: [] }));
  await page.route('**/api/tasks', route => route.fulfill({ json: [] }));
  await page.route('**/api/stats?**', route => route.fulfill({ json: [] }));
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.zones > .card[data-tool]')).toHaveCount(4);
});

for (const theme of ['light', 'dark'] as const) for (const width of [375, 768, 1440]) {
  test(`${theme} foundation fits ${width}px with reachable navigation and controls`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await setTheme(page, theme);
    const sizes = await page.evaluate(() => {
      const dashboard = document.querySelector('.dashboard-page')!;
      const sidebar = document.querySelector('.workspace-sidebar')!;
      return { page: document.documentElement.scrollWidth, viewport: innerWidth, dashboard: dashboard.scrollWidth, available: dashboard.clientWidth, sidebar: sidebar.getBoundingClientRect().width };
    });
    expect(sizes.page).toBeLessThanOrEqual(sizes.viewport);
    expect(sizes.dashboard).toBeLessThanOrEqual(sizes.available);
    if (width === 1440) {
      expect(sizes.sidebar).toBe(212);
      await expect(page.locator('.topbar')).toBeInViewport();
    } else {
      const toggle = page.getByRole('button', { name: 'Mở điều hướng', exact: true });
      await expect(toggle).toBeVisible();
      await toggle.click();
      await expect(page.getByRole('button', { name: 'So sánh agent', exact: true })).toBeVisible();
      await expect(page.locator('.workspace-sidebar')).toBeInViewport();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
    }
    await expect(page.getByRole('button', { name: 'VI', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Giao diện', exact: true })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`foundation-${width}-${theme}.png`), animations: 'disabled' });
  });
}

test('dark vendor chips keep substantial brand ink above 3:1 contrast', async ({ page }) => {
  await setTheme(page, 'dark');
  for (const agent of ['qodercli', 'opencode']) {
    const result = await page.locator(`[data-tool="${agent}"] .card-top .logo`).evaluate(async chip => {
      const img = chip.querySelector('img')!; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = Math.round(chip.getBoundingClientRect().width); canvas.height = Math.round(chip.getBoundingClientRect().height);
      const ctx = canvas.getContext('2d')!;
      // Use the actual computed vendor bed, including gradient colours.
      const computed = getComputedStyle(chip);
      ctx.fillStyle = computed.backgroundColor;
      const colours = computed.backgroundImage.match(/rgba?\([^)]+\)/g);
      if (colours && colours.length > 1) {
        const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        colours.forEach((colour, index) => gradient.addColorStop(index / (colours.length - 1), colour));
        ctx.fillStyle = gradient;
      }
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const backgrounds = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const imageStyle = getComputedStyle(img);
      const left = parseFloat(imageStyle.paddingLeft); const top = parseFloat(imageStyle.paddingTop);
      ctx.drawImage(img, left, top, canvas.width - left - parseFloat(imageStyle.paddingRight), canvas.height - top - parseFloat(imageStyle.paddingBottom));
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
      let contrastingPixels = 0; let maxContrast = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] < 230) continue;
        const background = luminance([...backgrounds.slice(i, i + 3)]);
        const ink = luminance([...pixels.slice(i, i + 3)]);
        const contrast = (Math.max(ink, background) + .05) / (Math.min(ink, background) + .05);
        maxContrast = Math.max(maxContrast, contrast);
        if (contrast >= 3) contrastingPixels++;
      }
      return { alpha: backgrounds[3], visibleInkRatio: contrastingPixels / (canvas.width * canvas.height), maxContrast, background: computed.backgroundImage === 'none' ? computed.backgroundColor : computed.backgroundImage };
    });
    expect(result.alpha).toBe(255);
    expect(result.visibleInkRatio, `${agent}: ${JSON.stringify(result)}`).toBeGreaterThan(.01);
  }
});
