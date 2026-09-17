import type { NavData, NavLink } from '@navbook/shared';

function safeHost(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

export default function App({ data }: { data: NavData }) {
  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <header className="mb-10 pb-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--color-text)' }}>
          {data.site_title}
        </h1>
        {data.site_subtitle && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-subtle)' }}>{data.site_subtitle}</p>
        )}
      </header>
      <nav>
        {data.categories.map(cat => (
          <section key={cat.id} className="mb-10">
            <h2 className="text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-1.5"
                style={{ color: 'var(--color-text-subtle)' }}>
              {cat.font_icon && <span className={cat.font_icon} aria-hidden />}
              {cat.name}
              {cat.private && <span title="私有">🔒</span>}
            </h2>
            <ul>
              {cat.links.map(l => <Row key={l.id} link={l} indent={false} />)}
              {cat.children.map(sub => (
                <li key={sub.id}>
                  <div className="text-xs font-medium mt-4 mb-1 pl-2 flex items-center gap-1"
                       style={{ color: 'var(--color-text-subtle)' }}>
                    {sub.name}
                    {sub.private && <span title="私有">🔒</span>}
                  </div>
                  <ul>{sub.links.map(l => <Row key={l.id} link={l} indent />)}</ul>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </nav>
    </main>
  );
}

function Row({ link, indent }: { link: NavLink; indent: boolean }) {
  return (
    <li className={indent ? 'pl-6' : ''}>
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-baseline justify-between py-2 px-2 -mx-2 rounded hover:bg-[var(--color-bg-subtle)]"
        style={{ color: 'var(--color-text)', opacity: link.private ? 0.7 : 1 }}
      >
        <span className="flex items-baseline gap-2 min-w-0">
          {link.font_icon && <span className={`${link.font_icon} text-sm`} aria-hidden />}
          <span className="truncate text-sm font-medium">{link.title}</span>
          {link.private && <span className="text-[10px]" title="私有">🔒</span>}
        </span>
        <span className="hidden sm:block truncate text-xs max-w-[40%]" style={{ color: 'var(--color-text-subtle)' }}>
          {safeHost(link.url)}
        </span>
      </a>
    </li>
  );
}
