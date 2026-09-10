import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { NavData } from '@/types/nav';
import { loadTheme } from '@/themes/loader';

export function ThemeRenderer({ themeId, data }: { themeId: string; data: NavData }) {
  const [Component, setComponent] = useState<ComponentType<{ data: NavData }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTheme(themeId).then(t => {
      if (cancelled) return;
      setComponent(() => t.Component);
      document.documentElement.dataset.theme = themeId;
      try { localStorage.setItem('onenav.theme', themeId); } catch { /* 忽略 */ }
    }).catch(console.error);
    return () => { cancelled = true; };
  }, [themeId]);

  // tokens 已内联在 index.html（构建期），此处无需注入 CSS，等待组件到达即无闪烁
  if (!Component) return null;
  return <Component data={data} />;
}
