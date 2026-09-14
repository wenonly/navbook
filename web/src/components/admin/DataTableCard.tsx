import type { ReactNode } from 'react';
import { Table, TableBody, TableHeader } from '@/components/ui/table';
import { TableLoadingOverlay } from './Loading';

interface DataTableCardProps {
  /** 列宽 px；0 = 弹性列（放最后）。单表格 + colgroup，天然不存在表头/表体错位 */
  cols: number[];
  /** <TableRow><TableHead>…</TableHead></TableRow>，表头单元格加 sticky 定位 */
  headers: ReactNode;
  loading?: boolean;
  /** 分页等，固定在滚动区外 */
  footer?: ReactNode;
  /** <TableRow><TableCell>…</TableCell></TableRow> */
  children: ReactNode;
}

/** 表格容器：sticky 表头 + 表体滚动。旧双表格方案（滚动条贯穿/列错位）废弃 */
export function DataTableCard({ cols, headers, loading, footer, children }: DataTableCardProps) {
  const colgroup = (
    <colgroup>
      {cols.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
    </colgroup>
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [&_table]:table-fixed">
        <Table>
          {colgroup}
          <TableHeader>
            {headers}
          </TableHeader>
          <TableBody>{children}</TableBody>
        </Table>
      </div>
      {loading && <TableLoadingOverlay />}
      {footer && <div className="shrink-0 border-t border-line px-4 py-2.5">{footer}</div>}
    </div>
  );
}
