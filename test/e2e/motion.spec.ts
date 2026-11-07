import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { DashboardTool } from '../../shared/dashboard.js';
import { referenceFixture } from './reference-fixture.js';
import { openJobs } from './jobs-fixture.js';
import { savedChecks } from './dashboard-fixture.js';

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

    // Complete the check
    resolveCheck();

    // Verify busy state is removed
    await expect(checkBtn).not.toHaveAttribute('aria-busy', 'true');
    await expect(checkBtn).not.toHaveClass(/is-checking/);
    await expect(codexCard).not.toHaveAttribute('aria-busy', 'true');
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
    await expect(notice).not.toContainText(/Sẵn sàng/i);
  });
});
