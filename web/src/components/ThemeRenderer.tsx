import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { NavData } from '@/types/nav';
import { loadTheme } from '@/themes/loader';

export function ThemeRenderer({ themeId, data }: { themeId: string; data: NavData }) {
  const [Component, setComponent] = useState<ComponentType<{ data: NavData }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const apply = (id: string, mod: { Component: ComponentType<{ data: NavData }> }) => {
      if (cancelled) return;
      setComponent(() => mod.Component);
      document.documentElement.dataset.theme = id;
      try { localStorage.setItem('onenav.theme', id); } catch { /* 忽略 */ }
    };
    loadTheme(themeId).then(t => apply(themeId, t)).catch(err => {
      console.error(err);
      // localStorage 残留已删主题 id 时不永久白屏，回落 default2
      if (themeId !== 'default2') loadTheme('default2').then(t => apply('default2', t)).catch(console.error);
    });
    return () => { cancelled = true; };
  }, [themeId]);

  // tokens 已内联在 index.html（构建期），此处无需注入 CSS，等待组件到达即无闪烁
  if (!Component) return null;
  return <Component data={data} />;
}
