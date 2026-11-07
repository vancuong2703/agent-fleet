import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { referenceFixture } from './reference-fixture.js';

test.describe('Dashboard Card Separation and Spotlight Focus', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('fleet.language', 'en');
      localStorage.setItem('fleet.theme', 'light');
    });
    await referenceFixture(page);
    const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
    await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  });

  test('the 4 CLI cards in .zones are visually separate cards with gap and border radius', async ({ page }) => {
    const cards = page.locator('.zones > .card');
    await expect(cards).toHaveCount(4);

    // Verify border-radius on each card >= 10px
    for (let i = 0; i < 4; i++) {
      const radius = await cards.nth(i).evaluate(el => {
        const style = getComputedStyle(el);
        return parseFloat(style.borderRadius);
      });
      expect(radius).toBeGreaterThanOrEqual(10);
    }

    // Verify horizontal gap between adjacent cards in 4-column layout >= 12px
    const box0 = (await cards.nth(0).boundingBox())!;
    const box1 = (await cards.nth(1).boundingBox())!;
    const gap = box1.x - (box0.x + box0.width);
    expect(gap).toBeGreaterThanOrEqual(12);
  });

  test('.row3 layout order is tokens -> jobs -> attention', async ({ page }) => {
    const panels = page.locator('.row3 > [data-card-id]');
    await expect(panels).toHaveCount(3);

    const ids = await panels.evaluateAll(els => els.map(el => el.getAttribute('data-card-id')));
    expect(ids).toEqual(['tokens', 'jobs', 'attention']);
  });

  test('clicking focus button spotlights card, dims siblings, and Escape clears spotlight', async ({ page }) => {
    const codexCard = page.locator('[data-card-id="cli:codex"]');
    const focusBtn = codexCard.locator('.card-focus-btn');
    await expect(focusBtn).toBeVisible();
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'false');

    // Click Focus on Codex card
    await focusBtn.click();
    await expect(focusBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(codexCard).toHaveClass(/is-focused/);

    // Verify other 6 cards (3 in .zones, 3 in .row3) have .is-dimmed
    const dimmedCards = page.locator('[data-card-id].is-dimmed');
    await expect(dimmedCards).toHaveCount(6);

    // Verify interactive controls inside dimmed cards remain clickable (pointer-events !== 'none')
    const qoderCard = page.locator('[data-card-id="cli:qodercli"]');
    await expect(qoderCard).toHaveClass(/is-dimmed/);
    const qoderDetailsBtn = qoderCard.getByRole('button', { name: /Details/i });
    const pointerEvents = await qoderDetailsBtn.evaluate(el => getComputedStyle(el).pointerEvents);
    expect(pointerEvents).not.toBe('none');

    // Press Escape to clear spotlight
    await page.keyboard.press('Escape');
    await expect(codexCard).not.toHaveClass(/is-focused/);
    await expect(page.locator('.is-dimmed')).toHaveCount(0);
    await expect(focusBtn).toBeFocused();
  });

  test('keyboard Tab into dimmed card automatically transfers spotlight to that card', async ({ page }) => {
    const codexCard = page.locator('[data-card-id="cli:codex"]');
    const qoderCard = page.locator('[data-card-id="cli:qodercli"]');

    // Focus Codex card first
    await codexCard.locator('.card-focus-btn').click();
    await expect(codexCard).toHaveClass(/is-focused/);
    await expect(qoderCard).toHaveClass(/is-dimmed/);

    // Focus a button inside qoderCard (simulating Tab navigating into it)
    await qoderCard.locator('.card-focus-btn').focus();

    // Now qoderCard becomes focused and codexCard becomes dimmed
    await expect(qoderCard).toHaveClass(/is-focused/);
    await expect(codexCard).toHaveClass(/is-dimmed/);
  });

  test('focusing any card (including Antigravity CLI in EN and VI) causes zero layout shift on all 7 cards', async ({ page }) => {
    for (const lang of ['en', 'vi'] as const) {
      await page.getByRole('button', { name: lang.toUpperCase(), exact: true }).click();
      // Ensure no card is focused initially
      await page.keyboard.press('Escape');
      await expect(page.locator('.is-focused')).toHaveCount(0);

      const getBoxes = () =>
        page.locator('[data-card-id]').evaluateAll(els =>
          els.map(el => {
            const r = el.getBoundingClientRect();
            return {
              id: el.getAttribute('data-card-id'),
              x: Math.round(r.x),
              y: Math.round(r.y),
              width: Math.round(r.width),
              height: Math.round(r.height),
            };
          }),
        );

      const baseline = await getBoxes();
      for (const item of baseline) {
        const card = page.locator(`[data-card-id="${item.id}"]`);
        await card.locator('.card-focus-btn').click();
        await expect(card).toHaveClass(/is-focused/);
        const afterFocus = await getBoxes();
        expect(afterFocus, `layout shift when focusing ${item.id} in ${lang}`).toEqual(baseline);

        // Also check that the focus button stays strictly inside the card and does not overlap title text or dot
        const headOverlap = await card.evaluate(el => {
          const cardRect = el.getBoundingClientRect();
          const btn = el.querySelector('.card-focus-btn')!.getBoundingClientRect();
          const h3 = el.querySelector('h3, h4')!.getBoundingClientRect();
          const tier = el.querySelector('.tier')?.getBoundingClientRect();
          const dot = el.querySelector('.card-top .dot')?.getBoundingClientRect();
          return {
            btnOutsideRight: btn.right > cardRect.right,
            overlapsHeading: btn.left < h3.right - 1 && btn.bottom > h3.top + 2 && btn.top < h3.bottom - 2,
            tierOverlapsDot: tier && dot ? tier.right > dot.left - 2 : false,
          };
        });
        expect(headOverlap, `header geometry for ${item.id} in ${lang}`).toEqual({
          btnOutsideRight: false,
          overlapsHeading: false,
          tierOverlapsDot: false,
        });
      }
      await page.keyboard.press('Escape');
    }
  });
});
