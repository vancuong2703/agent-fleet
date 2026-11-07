import { Palette, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useAppearance } from '../appearance.js';
import { useLanguage } from './language.js';

export interface AppearanceMenuProps {
  isDark?: boolean;
  defaultOpen?: boolean;
}

export function AppearanceMenu({ isDark, defaultOpen = false }: AppearanceMenuProps) {
  const { t } = useLanguage();
  const { appearance, updateAppearance, resetAppearance } = useAppearance();
  const [open, setOpen] = useState(defaultOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const isDarkDom =
    typeof document !== 'undefined' && document.documentElement?.dataset?.theme === 'dark';
  const darkActive = isDark !== undefined ? isDark : isDarkDom;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="appearance-menu-container">
      <button
        ref={triggerRef}
        type="button"
        className="btn ghost appearance-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Palette size={16} aria-hidden="true" />
        <span>{t('Appearance', 'Diện mạo')}</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={t('Appearance settings', 'Tuỳ chỉnh diện mạo')}
          className="popover appearance-popover"
        >
          <div className="appearance-section">
            <div className="appearance-section-title">{t('Light surface', 'Nền sáng')}</div>
            <div className="appearance-btn-group" role="group" aria-label={t('Light surface', 'Nền sáng')}>
              <button
                type="button"
                className={`btn ${appearance.style === 'plain' ? 'active' : ''}`}
                aria-pressed={appearance.style === 'plain'}
                disabled={darkActive}
                onClick={() => updateAppearance({ style: 'plain' })}
              >
                {t('White (default)', 'Trắng (mặc định)')}
              </button>
              <button
                type="button"
                className={`btn ${appearance.style === 'warm' ? 'active' : ''}`}
                aria-pressed={appearance.style === 'warm'}
                disabled={darkActive}
                onClick={() => updateAppearance({ style: 'warm' })}
              >
                {t('Warm paper', 'Giấy ấm')}
              </button>
            </div>
            {darkActive && (
              <p className="appearance-note">
                {t(
                  'Applies in light mode; saved for when you switch back.',
                  'Áp dụng cho chế độ sáng; lựa chọn sẽ có hiệu lực khi chuyển về giao diện sáng.',
                )}
              </p>
            )}
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">{t('Font', 'Phông chữ')}</div>
            <div className="appearance-btn-group" role="group" aria-label={t('Font', 'Phông chữ')}>
              <button
                type="button"
                className={`btn ${appearance.font === 'system' ? 'active' : ''}`}
                aria-pressed={appearance.font === 'system'}
                onClick={() => updateAppearance({ font: 'system' })}
              >
                Segoe UI
              </button>
              <button
                type="button"
                className={`btn ${appearance.font === 'inter' ? 'active' : ''}`}
                aria-pressed={appearance.font === 'inter'}
                onClick={() => updateAppearance({ font: 'inter' })}
              >
                Inter
              </button>
              <button
                type="button"
                className={`btn ${appearance.font === 'bricolage' ? 'active' : ''}`}
                aria-pressed={appearance.font === 'bricolage'}
                onClick={() => updateAppearance({ font: 'bricolage' })}
              >
                Bricolage
              </button>
            </div>
            <div className="appearance-font-preview" aria-hidden="true">
              Tiếng Việt rõ dấu — 12.450 token · 98%
            </div>
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">{t('Text size', 'Cỡ chữ')}</div>
            <div className="appearance-btn-group" role="group" aria-label={t('Text size', 'Cỡ chữ')}>
              <button
                type="button"
                className={`btn ${appearance.size === 'standard' ? 'active' : ''}`}
                aria-pressed={appearance.size === 'standard'}
                onClick={() => updateAppearance({ size: 'standard' })}
              >
                {t('Standard (15px)', 'Tiêu chuẩn (15px)')}
              </button>
              <button
                type="button"
                className={`btn ${appearance.size === 'large' ? 'active' : ''}`}
                aria-pressed={appearance.size === 'large'}
                onClick={() => updateAppearance({ size: 'large' })}
              >
                {t('Comfortable (16px)', 'Rộng rãi (16px)')}
              </button>
            </div>
          </div>

          <div className="appearance-section">
            <div className="appearance-section-title">{t('Motion', 'Chuyển động')}</div>
            <div className="appearance-btn-group" role="group" aria-label={t('Motion', 'Chuyển động')}>
              <button
                type="button"
                className={`btn ${appearance.motion === 'system' ? 'active' : ''}`}
                aria-pressed={appearance.motion === 'system'}
                onClick={() => updateAppearance({ motion: 'system' })}
              >
                {t('System', 'Theo hệ thống')}
              </button>
              <button
                type="button"
                className={`btn ${appearance.motion === 'reduced' ? 'active' : ''}`}
                aria-pressed={appearance.motion === 'reduced'}
                onClick={() => updateAppearance({ motion: 'reduced' })}
              >
                {t('Reduced', 'Giảm chuyển động')}
              </button>
              <button
                type="button"
                className={`btn ${appearance.motion === 'off' ? 'active' : ''}`}
                aria-pressed={appearance.motion === 'off'}
                onClick={() => updateAppearance({ motion: 'off' })}
              >
                {t('Off', 'Tắt')}
              </button>
            </div>
          </div>

          <div className="appearance-section appearance-footer">
            <button
              type="button"
              className="btn ghost appearance-reset"
              onClick={resetAppearance}
            >
              <RotateCcw size={14} aria-hidden="true" />
              <span>{t('Reset to default', 'Khôi phục mặc định')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
