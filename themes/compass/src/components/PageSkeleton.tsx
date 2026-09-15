/** 加载骨架：贴近真实布局（顶栏 + 侧栏 + 分类区块网格），shimmer 动画见 index.css */
export default function PageSkeleton() {
  return (
    <div className="min-h-screen" aria-label="加载中">
      {/* 顶栏 */}
      <div className="flex h-15 items-center gap-4 border-b border-border bg-surface px-4 lg:px-7">
        <div className="skeleton-block h-8.5 w-8.5 rounded-lg" />
        <div className="skeleton-block h-4 w-24" />
        <div className="flex-1" />
        <div className="skeleton-block hidden h-9.5 w-[26rem] rounded-input md:block" />
        <div className="skeleton-block h-9 w-9 rounded-lg" />
      </div>
      <div className="flex min-h-[calc(100vh_-_60px)]">
        {/* 侧栏 */}
        <aside className="hidden w-60 shrink-0 border-r border-border bg-surface p-4 lg:block">
          <div className="skeleton-block mb-4 h-3 w-14" />
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="skeleton-block mb-1.5 h-8.5 rounded-lg" />
          ))}
        </aside>
        {/* 主区 */}
        <main className="flex-1 space-y-7 p-5 lg:p-7">
          {Array.from({ length: 3 }, (_, s) => (
            <section key={s} className="space-y-3.5">
              <div className="flex items-center gap-2.5">
                <div className="skeleton-block h-7 w-7 rounded-lg" />
                <div className="skeleton-block h-4 w-28" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: s === 0 ? 8 : 4 }, (_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-card border border-border bg-card p-3">
                    <div className="skeleton-block h-10 w-10 rounded-[10px]" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton-block h-3 w-3/5" />
                      <div className="skeleton-block h-2.5 w-4/5" />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
