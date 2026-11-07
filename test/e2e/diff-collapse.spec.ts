import { expect, test } from '@playwright/test';
import { openJobs } from './jobs-fixture.js';

test.describe('Diff View True Collapse and Animation Cleanup', () => {
  test('collapsing a diff section reduces height to <= 48px and unmounts .diff-body-wrap', async ({ page }) => {
    await openJobs(page, { width: 1440, height: 900 }, { diffFiles: 3 });

    // Switch to Changes tab
    const diffTab = page.getByRole('tab', { name: /Changes|Thay đổi/i });
    await diffTab.click();

    const firstSection = page.locator('.diff-section').first();
    await expect(firstSection).toBeVisible();
    await expect(firstSection.locator('.diff-body-wrap')).toBeVisible();

    const toggle = firstSection.locator('.diff-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Click toggle to collapse
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Verify .diff-body-wrap is unmounted
    await expect(firstSection.locator('.diff-body-wrap')).toHaveCount(0);

    // Verify section height <= 48px (header only)
    const box = await firstSection.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(48);
  });

  test('clicking Collapse all leaves NO gray empty box below headers and transparent pane background', async ({ page }) => {
    await openJobs(page, { width: 1440, height: 900 }, { diffFiles: 3 });

    const diffTab = page.getByRole('tab', { name: /Changes|Thay đổi/i });
    await diffTab.click();

    const collapseAllBtn = page.getByRole('button', { name: /Collapse all|Thu gọn tất cả/i });
    await expect(collapseAllBtn).toBeVisible();
    await collapseAllBtn.click();

    // Verify every section is collapsed and body is unmounted
    const sections = page.locator('.diff-section');
    const count = await sections.count();
    expect(count).toBe(3);

    for (let i = 0; i < count; i++) {
      const section = sections.nth(i);
      await expect(section.locator('.diff-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(section.locator('.diff-body-wrap')).toHaveCount(0);
      const b = await section.boundingBox();
      expect(b).not.toBeNull();
      expect(b!.height).toBeLessThanOrEqual(48);
    }

    // Verify diff pane background is transparent (no gray empty box)
    const paneBg = await page.evaluate(() => {
      const el = document.querySelector('.diff-pane');
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    expect(paneBg).toBe('rgba(0, 0, 0, 0)');
  });

  test('rapid clicking 4x on diff toggle leaves section in consistent state matching aria-expanded', async ({ page }) => {
    await openJobs(page, { width: 1440, height: 900 }, { diffFiles: 3 });

    const diffTab = page.getByRole('tab', { name: /Changes|Thay đổi/i });
    await diffTab.click();

    const firstSection = page.locator('.diff-section').first();
    const toggle = firstSection.locator('.diff-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Click 4 times rapidly
    await toggle.click();
    await toggle.click();
    await toggle.click();
    await toggle.click();

    // Wait for any animation settle and check consistency
    const isExpanded = await toggle.getAttribute('aria-expanded');
    if (isExpanded === 'true') {
      await expect(firstSection.locator('.diff-body-wrap')).toBeVisible();
    } else {
      await expect(firstSection.locator('.diff-body-wrap')).toHaveCount(0);
      const box = await firstSection.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(48);
    }
  });
});
