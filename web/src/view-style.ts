import { useAppearance, type SurfaceStyle } from './appearance.js';

export function useViewStyle() {
  const { appearance, updateAppearance } = useAppearance();
  const style: SurfaceStyle = appearance.style;
  const toggleStyle = () => {
    updateAppearance({ style: style === 'warm' ? 'plain' : 'warm' });
  };
  return { style, toggleStyle };
}
