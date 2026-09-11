import { useState } from 'react';
import { usePublicNav } from '@/api/hooks';
import { ThemeRenderer } from '@/components/ThemeRenderer';
import { themeIds, displayName } from '@/themes/loader';

const DEFAULT_THEME = 'default2';

export function Home() {
  const { data, isLoading, isError } = usePublicNav();
  const [themeId, setThemeId] = useState(() => {
    try { return localStorage.getItem('onenav.theme') || DEFAULT_THEME; }
    catch { return DEFAULT_THEME; }
  });

  if (isError) return <div className="p-8">加载失败，请刷新重试</div>;
  if (isLoading || !data?.data) return <div className="p-8">加载中...</div>;

  return (
    <>
      <div className="fixed top-4 right-4 z-50">
        <select
          className="px-3 py-1 border rounded text-sm"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
          value={themeId}
          onChange={e => setThemeId(e.target.value)}
          aria-label="切换主题"
        >
          {themeIds.map(id => (
            <option key={id} value={id}>{displayName(id)}</option>
          ))}
        </select>
      </div>
      <ThemeRenderer themeId={themeId} data={data.data} />
    </>
  );
}
