/** 分类层级工具：后台表格分组展示、分类下拉分组共用 */

/** category_list 返回行（camelCase）；提交时映射回 snake_case */
export interface CategoryRow {
  id: number;
  name: string;
  property: number;
  weight: number;
  description: string | null;
  fontIcon: string | null;
  fid: number;
}

/** 顶级 = fid 为 0 或父分类不存在（兜底当顶级，对齐 public.ts 前台组装逻辑）。
    用途：TanStack 表格 data 顶层（树模式要求子行不能同时出现在顶层）、分类下拉分组 */
export function topsOf(all: CategoryRow[]): CategoryRow[] {
  return all.filter(c => c.fid === 0 || !all.some(p => p.id === c.fid));
}
