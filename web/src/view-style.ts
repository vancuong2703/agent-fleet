import { useEffect, useState } from 'react';

export function useViewStyle() {
  const [style, setStyle] = useState<'warm' | 'plain'>(() => {
    try { return localStorage.getItem('fleet.view-style') === 'plain' ? 'plain' : 'warm'; }
    catch { return 'warm'; }
  });
  useEffect(() => {
    document.documentElement.dataset.style = style;
    try { localStorage.setItem('fleet.view-style', style); } catch { /* Optional preference. */ }
  }, [style]);
  return { style, toggleStyle: () => setStyle(current => current === 'warm' ? 'plain' : 'warm') };
}
