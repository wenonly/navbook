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

/** 顶级 = fid 为 0 或父分类不存在（兜底当顶级，对齐 public.ts 前台组装逻辑） */
export function topsOf(all: CategoryRow[]): CategoryRow[] {
  return all.filter(c => c.fid === 0 || !all.some(p => p.id === c.fid));
}

/** 顶级在前、子分类紧跟其父；入参保持后端排序（weight desc, id desc），filter 保序 */
export function groupByParent(all: CategoryRow[]): Array<{ row: CategoryRow; child: boolean }> {
  return topsOf(all).flatMap(top => [
    { row: top, child: false },
    ...all.filter(c => c.fid === top.id).map(row => ({ row, child: true })),
  ]);
}
