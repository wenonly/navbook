import type { NavData, NavLink } from '@/types/nav';

export default function Default2({ data }: { data: NavData }) {
  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold" style={{ color: 'var(--color-text)' }}>
          {data.site_title}
        </h1>
        {data.site_subtitle && (
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-subtle)' }}>
            {data.site_subtitle}
          </p>
        )}
      </header>
      <div className="space-y-10">
        {data.categories.map(cat => (
          <section key={cat.id}>
            <h2
              className="text-xl font-semibold mb-4 flex items-center gap-2"
              style={{ color: 'var(--color-text)' }}
            >
              {cat.font_icon && <span className={cat.font_icon} aria-hidden />}
              {cat.name}
            </h2>

            {/* 顶级分类直挂的链接 */}
            {cat.links.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-4">
                {cat.links.map(link => <LinkCard key={link.id} link={link} />)}
              </div>
            )}

            {/* 二级分类 */}
            {cat.children.map(sub => (
              <div key={sub.id} className="mb-4">
                <h3
                  className="text-sm font-medium mb-2 uppercase tracking-wide"
                  style={{ color: 'var(--color-text-subtle)' }}
                >
                  {sub.font_icon && <span className={`${sub.font_icon} mr-1`} aria-hidden />}
                  {sub.name}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {sub.links.map(link => <LinkCard key={link.id} link={link} />)}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

function LinkCard({ link }: { link: NavLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block p-3 transition hover:shadow-md"
      style={{
        backgroundColor: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius)',
      }}
    >
      <div className="flex items-center gap-2 mb-1">
        {link.font_icon && <span className={link.font_icon} aria-hidden />}
        <span className="font-medium truncate text-sm" style={{ color: 'var(--color-text)' }}>
          {link.title}
        </span>
      </div>
      {link.description && (
        <p className="text-xs truncate" style={{ color: 'var(--color-text-subtle)' }}>
          {link.description}
        </p>
      )}
    </a>
  );
}
