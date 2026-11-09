import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Locator } from '@playwright/test';
import type { DashboardTool } from '../../shared/dashboard.js';
import { referenceFixture } from './reference-fixture.js';
import { openJobs } from './jobs-fixture.js';
import { savedChecks } from './dashboard-fixture.js';

async function expectCenteredRefresh(button: Locator) {
  // Pause rotation so its changing bounding box cannot hide a baseline offset.
  const offset = await button.evaluate((el) => {
    const svg = el.querySelector('svg:not(.check-pill-beam)') as SVGElement;
    const originalStyle = svg.getAttribute('style');
    try {
      svg.style.animation = 'none';
      svg.style.transition = 'none';
      svg.style.transform = 'none';
      const icon = svg.getBoundingClientRect();
      const button = el.getBoundingClientRect();
      return Math.abs(icon.y + icon.height / 2 - button.y - button.height / 2);
    } finally {
      if (originalStyle === null) svg.removeAttribute('style');
      else svg.setAttribute('style', originalStyle);
    }
  });
  expect.soft(offset, 'refresh glyph stays vertically centered').toBeLessThanOrEqual(0.5);
}

for (const theme of ['light', 'dark']) {
  for (const width of [375, 768, 1440]) {
    test(`check light is neutral and icons stay centered at ${width}px in ${theme}`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('requestfailed', request => errors.push(request.failure()?.errorText ?? 'request failed'));
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((theme) => {
        localStorage.setItem('fleet.language', 'en');
        localStorage.setItem('fleet.theme', theme);
      }, theme);
      await referenceFixture(page);
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route('**/api/dashboard/check', async route => {
        await pending;
        await route.fulfill({ json: {
          agent: 'codex', title: 'Codex', installed: true, configuredBin: null,
          suggestions: [], lastCheck: savedChecks.checks.codex,
        } });
      });
      const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
      await page.goto(`/auth?token=${encodeURIComponent(token)}`);
      const check = page.locator('[data-card-id="cli:codex"] .foot .btn').first();
      const all = page.locator('.check-all');
      await expect(check).toBeVisible();
      await expectCenteredRefresh(check);
      await expectCenteredRefresh(all);
      await page.screenshot({ path: testInfo.outputPath('idle.png'), fullPage: true });
      await check.click();
      await expect(check).toHaveAttribute('aria-busy', 'true');
      await expectCenteredRefresh(check);
      await expect(check.locator('.spin svg')).toHaveCSS('animation-name', 'spin');
      const beam = check.locator('.check-pill-beam rect');
      const stroke = await beam.evaluate(el => getComputedStyle(el).stroke);
      const channels = stroke.match(/[\d.]+/g)!.map(Number);
      expect.soft(channels[0], 'beam has a neutral gray hue').toBe(channels[1]);
      expect.soft(channels[1], 'beam has a neutral gray hue').toBe(channels[2]);
      expect.soft(channels[3] ?? 1, 'beam is translucent').toBeGreaterThan(0);
      expect.soft(channels[3] ?? 1, 'beam is translucent').toBeLessThan(1);
      const firstOffset = await beam.evaluate(el => getComputedStyle(el).strokeDashoffset);
      await expect.poll(() => beam.evaluate(el => getComputedStyle(el).strokeDashoffset)).not.toBe(firstOffset);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: testInfo.outputPath('checking.png'), fullPage: true });
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      release();
      await expect(check).not.toHaveAttribute('aria-busy', 'true');
      await expectCenteredRefresh(check);
      await all.click();
      await expect(all).not.toHaveAttribute('aria-busy', 'true');
      await expectCenteredRefresh(all);
      expect(errors).toEqual([]);
    });
  }
}

test.describe('Motion controls, button feedback, and check status honesty', () => {
  test('setting data-motion="off" sets animation and transition durations to <= 0.01ms and diff unmounts immediately', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    await referenceFixture(page);
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    // Open Appearance popover and select "Off" motion
    const trigger = page.locator('.appearance-trigger');
    await trigger.click();
    const popover = page.locator('.appearance-popover');
    await expect(popover).toBeVisible();
    await popover.getByRole('button', { name: /^Off$|^Tắt$/i }).click();

    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-motion', 'off');

    // Verify computed animation / transition durations on interactive elements
    const durations = await page.evaluate(() => {
      const btn = document.querySelector('.check-all') as HTMLElement;
      const card = document.querySelector('.zones > .card') as HTMLElement;
      const getDur = (el: HTMLElement) => {
        const style = getComputedStyle(el);
        const transDur = parseFloat(style.transitionDuration) || 0;
        const animDur = parseFloat(style.animationDuration) || 0;
        return { transDur, animDur };
      };
      return { btn: getDur(btn), card: getDur(card) };
    });

    // Durations in seconds: 0s transition, <= 0.0001s animation
    expect(durations.btn.transDur).toBeLessThanOrEqual(0.001);
    expect(durations.btn.animDur).toBeLessThanOrEqual(0.001);
    expect(durations.card.transDur).toBeLessThanOrEqual(0.001);

    // Navigate to Jobs -> Changes tab and verify diff collapse unmounts immediately
    await openJobs(page, { width: 1440, height: 900 }, { diffFiles: 2 });
    const diffTab = page.getByRole('tab', { name: /Changes|Thay đổi/i });
    await diffTab.click();

    const firstSection = page.locator('.diff-section').first();
    await expect(firstSection.locator('.diff-body-wrap')).toBeVisible();

    const toggle = firstSection.locator('.diff-toggle');
    await toggle.click();

    // With motion="off", collapse should be immediate (no running animation)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(firstSection.locator('.diff-body-wrap')).toHaveCount(0);
  });

  test('CLI check button has aria-busy="true" and .is-checking while pending, removed once finished', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    await referenceFixture(page);

    let resolveCheck!: () => void;
    const checkPromise = new Promise<void>((resolve) => {
      resolveCheck = resolve;
    });

    const readyCheck = {
      ...structuredClone(savedChecks.checks.codex),
      status: 'ready' as const,
      checkedAt: Date.now(),
    };

    const readyTool: DashboardTool = {
      agent: 'codex',
      title: 'Codex',
      installed: true,
      configuredBin: null,
      suggestions: [],
      lastCheck: readyCheck,
    };

    await page.route('**/api/dashboard/check', async (route) => {
      await checkPromise;
      await route.fulfill({ json: readyTool });
    });

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const codexCard = page.locator('[data-card-id="cli:codex"]');
    const checkBtn = codexCard.locator('.foot .btn').first();
    await expect(checkBtn).toBeVisible();
    await expect(checkBtn).not.toHaveAttribute('aria-busy', 'true');
    await expect(checkBtn).not.toHaveClass(/is-checking/);

    // Trigger check
    await checkBtn.click();

    // Verify busy state while pending
    await expect(checkBtn).toHaveAttribute('aria-busy', 'true');
    await expect(checkBtn).toHaveClass(/is-checking/);
    await expect(codexCard).toHaveAttribute('aria-busy', 'true');

    // The pill keeps its rotating conic beam, the refresh glyph itself spins,
    // and the busy button is not dimmed (group opacity would fade the beam).
    const pendingStyles = await checkBtn.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      const pillRect = el.querySelector('.check-pill-beam rect') as SVGRectElement;
      const svg = el.querySelector('.spin svg')!;
      return {
        beamAnimation: before.animationName,
        beamDuration: parseFloat(before.animationDuration) || 0,
        pillStrokeAnim: getComputedStyle(pillRect).animationName,
        iconAnimation: getComputedStyle(svg).animationName,
        opacity: parseFloat(getComputedStyle(el).opacity) || 0,
      };
    });
    expect(pendingStyles.beamAnimation).not.toBe('none');
    expect(pendingStyles.beamDuration).toBeGreaterThan(0);
    expect(pendingStyles.pillStrokeAnim).toBe('check-pill-stroke');
    expect(pendingStyles.iconAnimation).not.toBe('none');
    expect(pendingStyles.opacity).toBeGreaterThan(0.95);

    // Even under data-motion="reduced", active checking feedback remains visible and animated.
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'reduced'));
    const reducedStyles = await checkBtn.evaluate((el) => {
      const pillRect = el.querySelector('.check-pill-beam rect') as SVGRectElement;
      const svg = el.querySelector('.spin svg')!;
      return {
        pillStrokeAnim: getComputedStyle(pillRect).animationName,
        iconAnimation: getComputedStyle(svg).animationName,
      };
    });
    expect(reducedStyles.pillStrokeAnim).toBe('check-pill-stroke');
    expect(reducedStyles.iconAnimation).not.toBe('none');
    await page.evaluate(() => document.documentElement.setAttribute('data-motion', 'system'));

    // Complete the check
    resolveCheck();

    // Verify busy state is removed
    await expect(checkBtn).not.toHaveAttribute('aria-busy', 'true');
    await expect(checkBtn).not.toHaveClass(/is-checking/);
    await expect(codexCard).not.toHaveAttribute('aria-busy', 'true');
  });

  test('Check all shows a rotating beam and spinning icon while busy', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    await referenceFixture(page);

    let resolveAll!: () => void;
    const allPromise = new Promise<void>((resolve) => {
      resolveAll = resolve;
    });

    const readyTool: DashboardTool = {
      agent: 'codex',
      title: 'Codex',
      installed: true,
      configuredBin: null,
      suggestions: [],
      lastCheck: { ...structuredClone(savedChecks.checks.codex), status: 'ready' as const, checkedAt: Date.now() },
    };

    await page.route('**/api/dashboard/check', async (route) => {
      await allPromise;
      await route.fulfill({ json: readyTool });
    });

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const checkAllBtn = page.locator('.check-all');
    await expect(checkAllBtn).toBeVisible();
    await checkAllBtn.click();

    await expect(checkAllBtn).toHaveClass(/is-checking/);
    await expect(checkAllBtn).toHaveAttribute('aria-busy', 'true');

    const styles = await checkAllBtn.evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      const pillRect = el.querySelector('.check-pill-beam rect') as SVGRectElement;
      const svg = el.querySelector('.spin svg')!;
      return {
        beamAnimation: before.animationName,
        beamDuration: parseFloat(before.animationDuration) || 0,
        pillStrokeAnim: getComputedStyle(pillRect).animationName,
        iconAnimation: getComputedStyle(svg).animationName,
        opacity: parseFloat(getComputedStyle(el).opacity) || 0,
      };
    });
    expect(styles.beamAnimation).not.toBe('none');
    expect(styles.beamDuration).toBeGreaterThan(0);
    expect(styles.pillStrokeAnim).toBe('check-pill-stroke');
    expect(styles.iconAnimation).not.toBe('none');
    expect(styles.opacity).toBeGreaterThan(0.95);

    resolveAll();
    await expect(checkAllBtn).not.toHaveClass(/is-checking/);
  });

  test('notice banner accurately reflects needs-login and error statuses without false ready toast', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'vi');
      localStorage.setItem('fleet.theme', 'light');
    });
    await referenceFixture(page);

    const needsLoginCheck = {
      ...structuredClone(savedChecks.checks.codex),
      status: 'needs-login' as const,
      checkedAt: Date.now(),
    };

    const needsLoginTool: DashboardTool = {
      agent: 'codex',
      title: 'Codex',
      installed: true,
      configuredBin: null,
      suggestions: [],
      lastCheck: needsLoginCheck,
    };

    // 1. Check returns needs-login
    await page.route('**/api/dashboard/check', (route) =>
      route.fulfill({ json: needsLoginTool })
    );

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const codexCard = page.locator('[data-card-id="cli:codex"]');
    const checkBtn = codexCard.locator('.foot .btn').first();
    await checkBtn.click();

    const notice = page.locator('.dashboard-page > .notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/Cần đăng nhập/i);
    await expect(notice).not.toHaveClass(/error/);
    await expect(notice).not.toContainText(/Sẵn sàng/i);

    // 2. Check returns error
    const errorCheck = {
      ...structuredClone(savedChecks.checks.codex),
      status: 'error' as const,
      checkedAt: Date.now(),
    };

    const errorTool: DashboardTool = {
      agent: 'codex',
      title: 'Codex',
      installed: true,
      configuredBin: null,
      suggestions: [],
      lastCheck: errorCheck,
    };

    await page.route('**/api/dashboard/check', (route) =>
      route.fulfill({ json: errorTool })
    );

    await checkBtn.click();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/Lỗi kiểm tra/i);
    await expect(notice).toHaveClass(/error/);
    await expect(notice).toContainText(/Lỗi kiểm tra/i);
    await expect(notice).not.toContainText(/Sẵn sàng/i);
  });

  test('Antigravity CLI card fits without scrolling and aligns matrix time headers with donuts, with pill buttons', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    await referenceFixture(page);

    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);

    const agyCard = page.locator('[data-card-id="cli:agy"]');
    await expect(agyCard).toBeVisible();

    const metrics = await agyCard.evaluate((card) => {
      const cardStyle = getComputedStyle(card);
      const checkBtn = card.querySelector('.foot .btn:first-of-type') as HTMLElement;
      const detailsBtn = card.querySelector('.foot .btn.ghost') as HTMLElement;
      const checkAllBtn = document.querySelector('.check-all') as HTMLElement;

      const checkStyle = getComputedStyle(checkBtn);
      const detailsStyle = getComputedStyle(detailsBtn);
      const checkAllStyle = getComputedStyle(checkAllBtn);

      const ths = Array.from(card.querySelectorAll('.mtx thead th')).slice(1);
      const firstRowDonuts = Array.from(card.querySelectorAll('.mtx tbody tr:first-child td .donut'));

      const headerCenters = ths.map((th) => {
        const r = th.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const donutCenters = firstRowDonuts.map((d) => {
        const r = d.getBoundingClientRect();
        return r.left + r.width / 2;
      });

      return {
        scrollHeight: card.scrollHeight,
        clientHeight: card.clientHeight,
        overflowY: cardStyle.overflowY,
        checkRadius: checkStyle.borderRadius,
        detailsRadius: detailsStyle.borderRadius,
        detailsBorderWidth: detailsStyle.borderTopWidth,
        checkAllRadius: checkAllStyle.borderRadius,
        headerCenters,
        donutCenters,
      };
    });

    expect(metrics.overflowY).toBe('hidden');
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight);
    expect(metrics.checkRadius).toBe('999px');
    expect(metrics.detailsRadius).toBe('999px');
    expect(parseFloat(metrics.detailsBorderWidth)).toBeGreaterThan(0);
    expect(metrics.checkAllRadius).toBe('999px');
    expect(metrics.headerCenters).toHaveLength(2);
    expect(Math.abs(metrics.headerCenters[0]! - metrics.donutCenters[0]!)).toBeLessThanOrEqual(2);
    expect(Math.abs(metrics.headerCenters[1]! - metrics.donutCenters[1]!)).toBeLessThanOrEqual(2);
  });
});
