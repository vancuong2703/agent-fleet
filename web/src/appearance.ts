import { useEffect, useState } from 'react';

export type SurfaceStyle = 'plain' | 'warm';
export type UiFont = 'system' | 'inter' | 'bricolage';
export type FontScale = 'standard' | 'large';
export type MotionPreference = 'system' | 'reduced' | 'off';

export interface AppearancePreferences {
  style: SurfaceStyle;
  font: UiFont;
  size: FontScale;
  motion: MotionPreference;
}

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  style: 'plain',
  font: 'system',
  size: 'standard',
  motion: 'system',
};

export const APPEARANCE_STORAGE_KEY = 'fleet.appearance';
export const LEGACY_VIEW_STYLE_KEY = 'fleet.view-style';

export function normalizeAppearance(
  input: unknown,
  fallback: AppearancePreferences = DEFAULT_APPEARANCE,
): AppearancePreferences {
  if (!input || typeof input !== 'object') {
    return { ...fallback };
  }
  const obj = input as Record<string, unknown>;
  const style: SurfaceStyle =
    obj.style === 'plain' || obj.style === 'warm' ? obj.style : fallback.style;
  const font: UiFont =
    obj.font === 'system' || obj.font === 'inter' || obj.font === 'bricolage' ? obj.font : fallback.font;
  const size: FontScale =
    obj.size === 'standard' || obj.size === 'large' ? obj.size : fallback.size;
  const motion: MotionPreference =
    obj.motion === 'system' || obj.motion === 'reduced' || obj.motion === 'off' ? obj.motion : fallback.motion;
  return { style, font, size, motion };
}

export function readInitialAppearance(
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  nativeAppearance?: Partial<AppearancePreferences> | null,
): AppearancePreferences {
  if (nativeAppearance && typeof nativeAppearance === 'object') {
    const normalized = normalizeAppearance(nativeAppearance);
    if (storage) {
      try {
        storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalized));
        storage.removeItem(LEGACY_VIEW_STYLE_KEY);
      } catch {
        /* storage can be unavailable in private profiles */
      }
    }
    return normalized;
  }

  if (storage) {
    try {
      const stored = storage.getItem(APPEARANCE_STORAGE_KEY);
      if (stored !== null && stored !== undefined) {
        try {
          const parsed = JSON.parse(stored);
          return normalizeAppearance(parsed);
        } catch {
          return { ...DEFAULT_APPEARANCE };
        }
      }

      const legacy = storage.getItem(LEGACY_VIEW_STYLE_KEY);
      if (legacy === 'warm' || legacy === 'plain') {
        const migrated: AppearancePreferences = {
          ...DEFAULT_APPEARANCE,
          style: legacy,
        };
        try {
          storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(migrated));
          storage.removeItem(LEGACY_VIEW_STYLE_KEY);
        } catch {
          /* optional preference */
        }
        return migrated;
      }
    } catch {
      return { ...DEFAULT_APPEARANCE };
    }
  }

  return { ...DEFAULT_APPEARANCE };
}

export function applyAppearanceToDocument(
  prefs: AppearancePreferences,
  doc: Document = typeof document !== 'undefined' ? document : (undefined as unknown as Document),
): void {
  if (!doc?.documentElement) return;
  const ds = doc.documentElement.dataset;
  ds.style = prefs.style;
  ds.font = prefs.font;
  ds.size = prefs.size;
  ds.motion = prefs.motion;
}

export async function syncAppearanceToDesktop(prefs: AppearancePreferences): Promise<void> {
  if (typeof window === 'undefined') return;
  const bridge = window.chrome?.webview;
  if (!bridge?.postMessage) return;

  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  return new Promise<void>((resolve) => {
    let timer: number | undefined;
    const receive = (event: MessageEvent<{ type?: string; requestId?: string; ok?: boolean }>) => {
      const data = event?.data;
      if (data?.type === 'fleet:native-result' && data.requestId === requestId) {
        cleanup();
        resolve();
      }
    };
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      try {
        bridge.removeEventListener?.('message', receive as (event: MessageEvent) => void);
      } catch {
        /* ignore */
      }
    };
    timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2000);

    try {
      bridge.addEventListener?.('message', receive as (event: MessageEvent) => void);
      bridge.postMessage({ type: 'fleet:set-appearance', requestId, appearance: prefs });
    } catch {
      cleanup();
      resolve();
    }
  });
}

export function useAppearance() {
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => {
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    const native = typeof window !== 'undefined' ? window.__FLEET_DESKTOP__?.appearance : null;
    return readInitialAppearance(storage, native);
  });

  useEffect(() => {
    applyAppearanceToDocument(appearance);
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance));
        localStorage.removeItem(LEGACY_VIEW_STYLE_KEY);
      } catch {
        /* storage may be unavailable in private profiles */
      }
    }
    void syncAppearanceToDesktop(appearance);
  }, [appearance]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onDesktopReady = () => {
      if (window.__FLEET_DESKTOP__?.appearance) {
        setAppearance(normalizeAppearance(window.__FLEET_DESKTOP__.appearance));
      }
    };
    window.addEventListener('fleet:desktop-ready', onDesktopReady);
    return () => window.removeEventListener('fleet:desktop-ready', onDesktopReady);
  }, []);

  const updateAppearance = (partial: Partial<AppearancePreferences>) => {
    setAppearance((current) => normalizeAppearance({ ...current, ...partial }));
  };

  const resetAppearance = () => {
    setAppearance({ ...DEFAULT_APPEARANCE });
  };

  return {
    appearance,
    setAppearance,
    updateAppearance,
    resetAppearance,
  };
}
