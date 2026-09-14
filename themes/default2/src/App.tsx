import { useMemo } from 'react';
import type { NavData } from '@navbook/shared';
import { useTheme } from './hooks/useTheme';
import { useSession } from './hooks/useSession';
import { useScrollSpy } from './hooks/useScrollSpy';
import { buildIndex } from './lib/search';
import Topbar from './components/Topbar';
import Sidebar from './components/Sidebar';
import MobileChips from './components/MobileChips';
import SearchBox from './components/SearchBox';
import CategorySection from './components/CategorySection';
import Footer from './components/Footer';

export default function App({ data }: { data: NavData }) {
  const [mode, toggleTheme] = useTheme();
  const session = useSession();
  const searchIndex = useMemo(() => buildIndex(data.categories), [data]);
  const sectionIds = useMemo(
    () => data.categories.flatMap(c => [`cat-${c.id}`, ...c.children.map(s => `cat-${s.id}`)]),
    [data],
  );
  const activeId = useScrollSpy(sectionIds);
  const linkCount = useMemo(
    () => data.categories.reduce(
      (n, c) => n + c.links.length + c.children.reduce((m, s) => m + s.links.length, 0), 0),
    [data],
  );

  return (
    <div className="min-h-screen">
      <Topbar
        siteTitle={data.site_title || 'NavBook'}
        mode={mode}
        onToggleTheme={toggleTheme}
        session={session}
        searchIndex={searchIndex}
      />
      {/* 移动端：顶栏下整行搜索 + 分类 chips；桌面端搜索在顶栏内 */}
      <div className="px-4 pt-3 md:hidden">
        <SearchBox index={searchIndex} />
      </div>
      <MobileChips categories={data.categories} activeId={activeId} />
      <div className="flex items-start">
        <Sidebar categories={data.categories} activeId={activeId} session={session} />
        <main className="min-w-0 flex-1 p-4 md:p-7">
          {data.categories.length === 0 ? (
            <div className="rounded-card border border-dashed border-border px-4 py-16 text-center">
              <p className="text-sm text-muted">还没有任何分类</p>
              <p className="mt-1 text-xs text-faint">登录后进入后台管理添加书签</p>
            </div>
          ) : (
            <div className="space-y-7">
              {data.categories.map(cat => <CategorySection key={cat.id} cat={cat} />)}
            </div>
          )}
          <div className="mt-8">
            <Footer categories={data.categories.length} links={linkCount} />
          </div>
        </main>
      </div>
    </div>
  );
}
