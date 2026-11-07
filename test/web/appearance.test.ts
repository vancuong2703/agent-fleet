import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  APPEARANCE_STORAGE_KEY,
  LEGACY_VIEW_STYLE_KEY,
  normalizeAppearance,
  readInitialAppearance,
  applyAppearanceToDocument,
  type AppearancePreferences,
} from '../../web/src/appearance.js';
import { AppearanceMenu } from '../../web/src/ui/AppearanceMenu.js';

function createMockStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    get: (key: string) => store.get(key),
  };
}

describe('T2: Appearance preferences and normalization', () => {
  test('DEFAULT_APPEARANCE matches calm workspace defaults', () => {
    expect(DEFAULT_APPEARANCE).toEqual({
      style: 'plain',
      font: 'system',
      size: 'standard',
      motion: 'system',
    });
  });

  test('normalizeAppearance validates and falls back field-by-field', () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance('invalid')).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance({})).toEqual(DEFAULT_APPEARANCE);

    // Valid partial
    expect(normalizeAppearance({ font: 'bricolage' })).toEqual({
      style: 'plain',
      font: 'bricolage',
      size: 'standard',
      motion: 'system',
    });

    // Invalid enum values fall back field-by-field
    expect(
      normalizeAppearance({
        style: 'neon',
        font: 'comic-sans',
        size: 'huge',
        motion: 'instant',
      }),
    ).toEqual(DEFAULT_APPEARANCE);

    // Valid mixed with invalid
    expect(
      normalizeAppearance({
        style: 'warm',
        font: 'invalid',
        size: 'large',
        motion: 'invalid',
      }),
    ).toEqual({
      style: 'warm',
      font: 'system',
      size: 'large',
      motion: 'system',
    });

    // Custom fallback
    const customFallback: AppearancePreferences = {
      style: 'warm',
      font: 'inter',
      size: 'large',
      motion: 'off',
    };
    expect(normalizeAppearance({ font: 'bricolage' }, customFallback)).toEqual({
      style: 'warm',
      font: 'bricolage',
      size: 'large',
      motion: 'off',
    });
  });

  test('readInitialAppearance prioritizes nativeAppearance and persists to storage', () => {
    const storage = createMockStorage({ [APPEARANCE_STORAGE_KEY]: '{"style":"warm"}' });
    const native = { style: 'plain' as const, font: 'inter' as const };
    const result = readInitialAppearance(storage, native);

    expect(result).toEqual({
      style: 'plain',
      font: 'inter',
      size: 'standard',
      motion: 'system',
    });
    expect(storage.get(APPEARANCE_STORAGE_KEY)).toBe(JSON.stringify(result));
  });

  test('readInitialAppearance parses valid stored JSON', () => {
    const storage = createMockStorage({
      [APPEARANCE_STORAGE_KEY]: JSON.stringify({
        style: 'warm',
        font: 'bricolage',
        size: 'large',
        motion: 'reduced',
      }),
    });
    const result = readInitialAppearance(storage);
    expect(result).toEqual({
      style: 'warm',
      font: 'bricolage',
      size: 'large',
      motion: 'reduced',
    });
  });

  test('readInitialAppearance falls back safely when stored JSON is corrupt', () => {
    const storage = createMockStorage({
      [APPEARANCE_STORAGE_KEY]: '{corrupt-json-not-valid',
    });
    const result = readInitialAppearance(storage);
    expect(result).toEqual(DEFAULT_APPEARANCE);
  });

  test('readInitialAppearance migrates legacy fleet.view-style warm to fleet.appearance and cleans up', () => {
    const storage = createMockStorage({
      [LEGACY_VIEW_STYLE_KEY]: 'warm',
    });
    const result = readInitialAppearance(storage);
    expect(result).toEqual({
      style: 'warm',
      font: 'system',
      size: 'standard',
      motion: 'system',
    });
    expect(storage.getItem(LEGACY_VIEW_STYLE_KEY)).toBeNull();
    expect(storage.get(APPEARANCE_STORAGE_KEY)).toBe(JSON.stringify(result));
  });

  test('readInitialAppearance migrates legacy fleet.view-style plain to fleet.appearance and cleans up', () => {
    const storage = createMockStorage({
      [LEGACY_VIEW_STYLE_KEY]: 'plain',
    });
    const result = readInitialAppearance(storage);
    expect(result).toEqual({
      style: 'plain',
      font: 'system',
      size: 'standard',
      motion: 'system',
    });
    expect(storage.getItem(LEGACY_VIEW_STYLE_KEY)).toBeNull();
    expect(storage.get(APPEARANCE_STORAGE_KEY)).toBe(JSON.stringify(result));
  });

  test('readInitialAppearance returns DEFAULT_APPEARANCE when storage is empty or null', () => {
    expect(readInitialAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    const storage = createMockStorage({});
    expect(readInitialAppearance(storage)).toEqual(DEFAULT_APPEARANCE);
  });

  test('applyAppearanceToDocument sets data-style, data-font, data-size, and data-motion', () => {
    const mockDoc = {
      documentElement: {
        dataset: {} as Record<string, string>,
      },
    } as unknown as Document;

    applyAppearanceToDocument(
      {
        style: 'warm',
        font: 'inter',
        size: 'large',
        motion: 'reduced',
      },
      mockDoc,
    );

    expect(mockDoc.documentElement.dataset.style).toBe('warm');
    expect(mockDoc.documentElement.dataset.font).toBe('inter');
    expect(mockDoc.documentElement.dataset.size).toBe('large');
    expect(mockDoc.documentElement.dataset.motion).toBe('reduced');
  });
});

describe('T2: AppearanceMenu UI component', () => {
  test('renders trigger button with accessible attributes and label', () => {
    const html = renderToStaticMarkup(createElement(AppearanceMenu, { defaultOpen: false }));
    expect(html).toContain('appearance-trigger');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('Diện mạo');
    expect(html).not.toContain('appearance-popover');
  });

  test('when open, renders dialog with all options, controls, and Vietnamese diacritics sample', () => {
    const html = renderToStaticMarkup(createElement(AppearanceMenu, { defaultOpen: true }));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Tuỳ chỉnh diện mạo"');
    expect(html).toContain('aria-expanded="true"');

    // Surface styles
    expect(html).toContain('Nền sáng');
    expect(html).toContain('Trắng (mặc định)');
    expect(html).toContain('Giấy ấm');

    // Fonts & Vietnamese sample
    expect(html).toContain('Phông chữ');
    expect(html).toContain('Segoe UI');
    expect(html).toContain('Inter');
    expect(html).toContain('Bricolage');
    expect(html).toContain('Tiếng Việt rõ dấu — 12.450 token · 98%');

    // Text size
    expect(html).toContain('Cỡ chữ');
    expect(html).toContain('Tiêu chuẩn (15px)');
    expect(html).toContain('Rộng rãi (16px)');

    // Motion
    expect(html).toContain('Chuyển động');
    expect(html).toContain('Theo hệ thống');
    expect(html).toContain('Giảm chuyển động');
    expect(html).toContain('Tắt');

    // Reset button
    expect(html).toContain('Khôi phục mặc định');
  });

  test('when dark mode is active, surface buttons are disabled and explanation note is displayed', () => {
    const html = renderToStaticMarkup(
      createElement(AppearanceMenu, { defaultOpen: true, isDark: true }),
    );
    expect(html).toContain('disabled=""');
    expect(html).toContain(
      'Áp dụng cho chế độ sáng; lựa chọn sẽ có hiệu lực khi chuyển về giao diện sáng.',
    );
  });
});
