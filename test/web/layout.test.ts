import { expect, test } from 'vitest';
import { clampLayout, normalizeLayout } from '../../web/src/layout.js';

test('a temporarily smaller viewport does not destroy the requested column dimensions', () => {
  const preferred = normalizeLayout({ sidebarWidth:310, inspectorWidth:380, terminalHeight:520 });
  expect(clampLayout(preferred,961,800).inspectorWidth).toBe(291);
  expect(clampLayout(preferred,1440,940)).toEqual(preferred);
  expect(preferred).toEqual({sidebarWidth:310,inspectorWidth:380,terminalHeight:520});
});

test('layout preferences reject nonfinite values and stay within native storage limits', () => {
  expect(normalizeLayout({ sidebarWidth:Infinity,inspectorWidth:9000,terminalHeight:-1 })).toEqual({sidebarWidth:190,inspectorWidth:520,terminalHeight:240});
});
