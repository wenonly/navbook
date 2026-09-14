import type { NavCategory, SessionInfo } from '@navbook/shared';
import { toneOf, toneFg } from '../lib/tone';
import { IconLock } from './Icons';

interface Props {
  categories: NavCategory[];
  activeId: string | null;
  session: SessionInfo | null;
}

const countOf = (c: NavCategory) => c.links.length + c.children.reduce((n, s) => n + s.links.length, 0);

export default function Sidebar({ categories, activeId, session }: Props) {
  const logged = !!session?.username;
  return (
    <aside className="sticky top-15 hidden h-[calc(100vh_-_60px)] w-60 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <nav className="sidebar-scroll flex-1 p-3.5" aria-label="分类导航">
        <p className="px-2.5 pb-1.5 text-[11px] tracking-widest text-faint">全部分类</p>
        {categories.map(cat => {
          const active = `cat-${cat.id}` === activeId;
          const tone = toneOf(cat.name);
          return (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              aria-current={active ? 'true' : undefined}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition
                ${active
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'text-fg hover:bg-field'}`}
            >
              {cat.font_icon ? (
                <i className={`${cat.font_icon} w-4 text-center text-base ${active ? 'text-accent' : 'text-muted'}`} aria-hidden />
              ) : (
                <span className={`w-4 text-center text-sm font-semibold ${active ? 'text-accent' : toneFg(tone)}`} aria-hidden>
                  {cat.name.charAt(0)}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{cat.name}</span>
              {cat.private && <IconLock size={10} className="shrink-0 text-faint" />}
              <span className={`shrink-0 text-xs ${active ? 'text-accent' : 'text-faint'}`}>{countOf(cat)}</span>
            </a>
          );
        })}
      </nav>
      <div className="p-3.5 pt-0">
        {logged ? (
          <a
            href="/admin"
            className="flex h-8.5 w-full items-center justify-center rounded-lg bg-accent text-[13px] font-medium text-white transition hover:bg-accent-strong"
          >
            进入后台管理
          </a>
        ) : (
          <div className="rounded-[10px] bg-field p-3">
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <IconLock size={13} className="shrink-0" />
              登录后可查看私有链接
            </p>
            <a
              href={`/admin/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
              className="mt-2 flex h-7.5 w-full items-center justify-center rounded-lg bg-accent text-xs font-medium text-white transition hover:bg-accent-strong"
            >
              登录
            </a>
          </div>
        )}
      </div>
    </aside>
  );
}
