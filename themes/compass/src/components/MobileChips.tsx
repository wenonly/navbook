import type { NavCategory } from '@navbook/shared';
import { toneFg, toneOf } from '../lib/tone';

/** 移动端分类 chips：横向滚动，点击锚点跳转；激活分类含子分类时，下方展开二级 chips */
export default function MobileChips({ categories, activeId }: { categories: NavCategory[]; activeId: string | null }) {
  const activeCat = categories.find(
    c => `cat-${c.id}` === activeId || c.children.some(s => `cat-${s.id}` === activeId),
  );
  return (
    <nav className="sticky top-15 z-30 border-b border-border bg-bg px-4 py-2.5 md:hidden" aria-label="分类导航">
      <div className="chips-scroll flex gap-1.5">
        {categories.map(cat => {
          const active = `cat-${cat.id}` === activeId;
          const inGroup = cat.id === activeCat?.id;
          return (
            <a
              key={cat.id}
              href={`#cat-${cat.id}`}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition
                ${active || inGroup
                  ? 'bg-accent font-medium text-white'
                  : 'border border-border bg-surface text-fg'}`}
            >
              {cat.font_icon ? (
                <i className={`${cat.font_icon} ${active || inGroup ? 'text-white' : toneFg(toneOf(cat.name))}`} aria-hidden />
              ) : null}
              {cat.name}
            </a>
          );
        })}
      </div>
      {activeCat && activeCat.children.length > 0 && (
        <div className="chips-scroll mt-2 flex gap-1.5">
          <a
            href={`#cat-${activeCat.id}`}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition
              ${`cat-${activeCat.id}` === activeId
                ? 'bg-accent-soft font-medium text-accent'
                : 'bg-field text-muted'}`}
          >
            全部
          </a>
          {activeCat.children.map(sub => (
            <a
              key={sub.id}
              href={`#cat-${sub.id}`}
              className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] transition
                ${`cat-${sub.id}` === activeId
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'bg-field text-muted'}`}
            >
              {sub.name}
            </a>
          ))}
        </div>
      )}
    </nav>
  );
}
