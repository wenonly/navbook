// Gazette · 公报 —— 期刊目录风主题(design.pen 规格实现)
// 结构:刊头 masthead → 栏目索引 → 主栏(目录条目)+ 副栏(统计/栏目一览/编者按)→ 版权行
import type { NavCategory, NavData, NavLink, SessionInfo } from '@navbook/shared';
import AssistantBubble from './components/AssistantBubble';

const CN_NUM = ['壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖', '拾'];
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function safeHost(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/** 日期行:2026年9月17日 · 星期四 · 共 N 条书目 */
function dateLine(total: number): string {
  const d = new Date();
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · 星期${WEEK[d.getDay()]} · 共 ${total} 条书目`;
}

function countLinks(cat: NavCategory): number {
  return cat.links.length + cat.children.reduce((n, s) => n + s.links.length, 0);
}

export default function App({ data, session }: { data: NavData; session: SessionInfo | null }) {
  const total = data.categories.reduce((n, c) => n + countLinks(c), 0);
  const sectionCount = data.categories.reduce((n, c) => n + 1 + c.children.length, 0);

  return (
    <div className="gz-page">
      <header className="gz-masthead">
        <hr className="gz-masthead-rule" />
        <h1 className="gz-masthead-title">{data.site_title || 'NavBook'}</h1>
        <p className="gz-masthead-date">{dateLine(total)}</p>
        <hr className="gz-masthead-rule gz-masthead-rule-bottom" />
      </header>

      <nav className="gz-index" aria-label="栏目索引">
        <a className="gz-chip" href="#gz-top" aria-current="true">全部</a>
        {data.categories.map(cat => (
          <a key={cat.id} className="gz-chip" href={`#gz-cat-${cat.id}`}>
            {cat.name}{cat.private && <span title="私密栏目"> ·密</span>}
          </a>
        ))}
      </nav>

      <div className="gz-main" id="gz-top">
        <main>
          {data.categories.map((cat, i) => (
            <Section key={cat.id} cat={cat} no={CN_NUM[i] ?? String(i + 1)} />
          ))}
          {!data.categories.length && (
            <p className="gz-loading" style={{ padding: '3rem 0' }}>尚无书目 · 请登录后台添加</p>
          )}
        </main>

        <aside className="gz-aside">
          <div className="gz-aside-block">
            <h3 className="gz-aside-title">藏书统计</h3>
            <div className="gz-stat-row"><span className="gz-stat-num">{total}</span><span className="gz-stat-label">条书目</span></div>
            <div className="gz-stat-row"><span className="gz-stat-num">{sectionCount}</span><span className="gz-stat-label">个栏目</span></div>
          </div>

          <div className="gz-aside-block">
            <h3 className="gz-aside-title">栏目一览</h3>
            {data.categories.map(cat => (
              <a key={cat.id} className="gz-aside-item" href={`#gz-cat-${cat.id}`}>
                <span className="gz-aside-item-name">{cat.name}</span>
                <span className="gz-aside-item-count">{countLinks(cat)}</span>
              </a>
            ))}
          </div>

          <div className="gz-aside-block">
            <h3 className="gz-aside-title">编者按</h3>
            <p className="gz-editor-note">
              {data.site_subtitle || '「目录贵精不贵多。每一条,都须亲手点开、反复用过,方可入册。」'}
            </p>
          </div>
        </aside>
      </div>

      <footer className="gz-colophon">
        <hr className="gz-colophon-rule" style={{ position: 'static', border: 'none', borderTop: '1px solid var(--ink)', margin: 0, width: '100%' }} />
        <span>{data.site_title || 'NavBook'} · 藏书目</span>
        <span>排印于边缘</span>
      </footer>

      <AssistantBubble session={session} />
    </div>
  );
}

/** 父栏目:栏头(汉字编号)+ 直属条目 + 子栏小节;条目编号父栏目内连续(含子栏) */
function Section({ cat, no }: { cat: NavCategory; no: string }) {
  let seq = 0;
  const next = () => String(++seq).padStart(2, '0');
  return (
    <section className="gz-section" id={`gz-cat-${cat.id}`}>
      <div className="gz-section-head">
        <span className="gz-section-no">{no}</span>
        <span className="gz-section-name">{cat.name}</span>
        {cat.private && <span className="gz-seal-mark" title="私密栏目">密</span>}
        {cat.description && <span className="gz-section-desc">{cat.description}</span>}
        <span className="gz-section-count">共 {countLinks(cat)} 条</span>
      </div>

      <div>
        {cat.links.map(l => <Entry key={l.id} link={l} no={next()} />)}
        {cat.children.map(sub => (
          <div key={sub.id} className="gz-sub">
            <div className="gz-subhead">
              <span className="gz-subhead-name">{sub.name}</span>
              {sub.private && <span className="gz-seal-mark" title="私密栏目">密</span>}
              {sub.description && <span className="gz-subhead-desc">{sub.description}</span>}
              <span className="gz-subhead-count">共 {sub.links.length} 条</span>
            </div>
            <div className="gz-sub-entries">
              {sub.links.map(l => <Entry key={l.id} link={l} no={next()} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** 目录条目:编号 标题 ······ 域名;描述一行;私密盖密章 */
function Entry({ link, no }: { link: NavLink; no: string }) {
  return (
    <a className="gz-entry" href={link.url} target="_blank" rel="noopener noreferrer">
      <span className="gz-entry-row">
        <span className="gz-entry-no">{no}</span>
        <span className={`gz-entry-title${link.private ? ' gz-private' : ''}`}>{link.title}</span>
        {link.private && <span className="gz-seal-mark" title="私密书签">密</span>}
        <span className="gz-entry-dots" aria-hidden />
        <span className="gz-entry-host">{safeHost(link.url)}</span>
      </span>
      {link.description && <span className="gz-entry-desc">{link.description}</span>}
    </a>
  );
}
