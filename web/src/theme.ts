import { useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(() => {
    const nativeTheme = window.__FLEET_DESKTOP__?.theme;
    if (nativeTheme === 'light' || nativeTheme === 'dark' || nativeTheme === 'system') return nativeTheme;
    try { const value = localStorage.getItem('fleet.theme'); return value === 'light' || value === 'dark' || value === 'system' ? value : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.style.colorScheme = document.documentElement.dataset.theme;
    };
    apply();
    try { localStorage.setItem('fleet.theme', theme); } catch { /* Storage can be unavailable in private profiles. */ }
    try { window.chrome?.webview?.postMessage({ type: 'fleet:set-theme', theme }); } catch { /* Browser preview has no native profile. */ }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme };
}
