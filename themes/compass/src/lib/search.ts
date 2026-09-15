import type { NavCategory, NavLink } from '@navbook/shared';

export interface SearchItem {
  link: NavLink;
  /** 所属分类路径，如「开发工具 / 前端」，用于结果里的归属提示 */
  catPath: string;
  /** 小写化后的检索文本 */
  hay: string;
}

/** 展平两级分类树为可检索列表（分类名也计入 hay，搜「工具」能搜到所属链接） */
export function buildIndex(categories: NavCategory[]): SearchItem[] {
  const items: SearchItem[] = [];
  for (const cat of categories) {
    for (const link of cat.links) {
      items.push(mk(link, cat.name));
    }
    for (const sub of cat.children) {
      for (const link of sub.links) {
        items.push(mk(link, `${cat.name} / ${sub.name}`));
      }
    }
  }
  return items;
}

function mk(link: NavLink, catPath: string): SearchItem {
  return {
    link,
    catPath,
    hay: `${link.title} ${link.description ?? ''} ${link.url} ${catPath}`.toLowerCase(),
  };
}

const MAX_RESULTS = 8;

/** 朴素子串匹配：标题命中排前，其次描述/分类，最后 URL */
export function search(index: SearchItem[], query: string): SearchItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { item: SearchItem; score: number }[] = [];
  for (const item of index) {
    const title = item.link.title.toLowerCase();
    let score = -1;
    if (title.startsWith(q)) score = 0;
    else if (title.includes(q)) score = 1;
    else if (item.hay.includes(q)) score = 2;
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score || a.item.link.title.length - b.item.link.title.length);
  return scored.slice(0, MAX_RESULTS).map(s => s.item);
}
