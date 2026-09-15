import type { NavCategory } from '@navbook/shared';
import { toneAt, toneOf } from '../lib/tone';
import IconTile from './IconTile';
import LinkCard from './LinkCard';
import { IconLock } from './Icons';

const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
const countOf = (c: NavCategory) => c.links.length + c.children.reduce((n, s) => n + s.links.length, 0);

export default function CategorySection({ cat }: { cat: NavCategory }) {
  const total = countOf(cat);
  const empty = total === 0;
  return (
    <section id={`cat-${cat.id}`} aria-label={cat.name} className="scroll-mt-27">
      <header className="mb-3.5 flex items-center gap-2.5">
        <IconTile icon={cat.font_icon} label={cat.name} tone={toneOf(cat.name)} size="section" />
        <h2 className="text-[17px] font-semibold text-fg">{cat.name}</h2>
        <span className="text-xs text-faint">· {total} 个链接</span>
        {cat.private && (
          <span className="text-faint" title="私有分类（仅登录后可见）">
            <IconLock size={13} />
          </span>
        )}
        {cat.description && (
          <span className="ml-1 hidden max-w-[25rem] truncate text-xs text-faint lg:block" title={cat.description}>
            {cat.description}
          </span>
        )}
      </header>

      {empty ? (
        <p className="rounded-card border border-dashed border-border px-4 py-6 text-center text-xs text-faint">
          暂无链接
        </p>
      ) : (
        <div className="space-y-4">
          {cat.links.length > 0 && (
            <div className={GRID}>
              {cat.links.map((link, i) => <LinkCard key={link.id} link={link} tone={toneAt(i, cat.id)} />)}
            </div>
          )}
          {cat.children.map(sub => (
            <div key={sub.id} id={`cat-${sub.id}`} className="scroll-mt-27">
              <div className="mb-2.5 flex items-center gap-2">
                <span className="h-3.5 w-[3px] rounded-full bg-accent" aria-hidden />
                <h3 className="text-[13px] font-medium text-muted">
                  {sub.font_icon && <i className={`${sub.font_icon} mr-1.5`} aria-hidden />}
                  {sub.name}
                </h3>
                <span className="text-[11px] text-faint">· {sub.links.length} 个链接</span>
                {sub.private && <IconLock size={10} className="text-faint" />}
              </div>
              <div className={GRID}>
                {sub.links.map((link, i) => <LinkCard key={link.id} link={link} tone={toneAt(i, sub.id)} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
