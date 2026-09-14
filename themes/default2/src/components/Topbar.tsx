import type { SessionInfo } from '@navbook/shared';
import type { SearchItem } from '../lib/search';
import type { ThemeMode } from '../hooks/useTheme';
import SearchBox from './SearchBox';
import { IconCompass, IconMoon, IconSun } from './Icons';

interface Props {
  siteTitle: string;
  mode: ThemeMode;
  onToggleTheme: () => void;
  session: SessionInfo | null;
  searchIndex: SearchItem[];
}

export default function Topbar({ siteTitle, mode, onToggleTheme, session, searchIndex }: Props) {
  const user = session?.username;
  return (
    <header className="sticky top-0 z-40 flex h-15 items-center gap-3 border-b border-border bg-surface px-4 lg:gap-4 lg:px-7">
      <a href="#top" className="flex items-center gap-2.5" title="回到顶部">
        <span className="flex h-8.5 w-8.5 items-center justify-center rounded-[9px] bg-gradient-to-br from-[#2F6BFF] to-[#7C3AED] text-white">
          <IconCompass size={18} />
        </span>
        <span className="max-w-40 truncate text-[17px] font-semibold tracking-wide text-fg">
          {siteTitle}
        </span>
      </a>
      <div className="flex-1" />
      {/* 桌面搜索：移动端用顶栏下方的整行搜索（见 App） */}
      <SearchBox index={searchIndex} className="hidden w-[440px] md:block" />
      <button
        type="button"
        onClick={onToggleTheme}
        aria-label={mode === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
        title={mode === 'dark' ? '切换到亮色模式' : '切换到暗色模式'}
        className="flex h-9 w-9 items-center justify-center rounded-input bg-field text-muted transition hover:text-fg"
      >
        {mode === 'dark' ? <IconSun size={17} /> : <IconMoon size={17} />}
      </button>
      {user ? (
        <a
          href="/admin"
          title="进入后台管理"
          className="flex h-9 items-center gap-2 rounded-input border border-accent bg-accent-soft px-2.5 text-accent"
        >
          <span className="flex h-6.5 w-6.5 items-center justify-center rounded-full text-xs font-semibold">
            {user.charAt(0).toUpperCase()}
          </span>
          <span className="hidden max-w-24 truncate text-[13px] font-medium sm:block">{user}</span>
        </a>
      ) : (
        <a
          href={`/admin/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
          className="flex h-9 items-center rounded-input bg-accent px-4.5 text-[13px] font-medium text-white transition hover:bg-accent-strong"
        >
          登录
        </a>
      )}
    </header>
  );
}
