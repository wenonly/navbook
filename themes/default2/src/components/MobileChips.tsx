import type { NavCategory } from '@navbook/shared';
import { toneFg, toneOf } from '../lib/tone';

/** 移动端分类 chips：横向滚动，点击锚点跳转 */
export default function MobileChips({ categories, activeId }: { categories: NavCategory[]; activeId: string | null }) {
  return (
    <nav className="chips-scroll sticky top-15 z-30 flex gap-1.5 border-b border-border bg-bg px-4 py-2.5 md:hidden" aria-label="分类导航">
      {categories.map(cat => {
        const active = `cat-${cat.id}` === activeId;
        return (
          <a
            key={cat.id}
            href={`#cat-${cat.id}`}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition
              ${active
                ? 'bg-accent font-medium text-white'
                : 'border border-border bg-surface text-fg'}`}
          >
            {cat.font_icon ? (
              <i className={`${cat.font_icon} ${active ? 'text-white' : toneFg(toneOf(cat.name))}`} aria-hidden />
            ) : null}
            {cat.name}
          </a>
        );
      })}
    </nav>
  );
}
