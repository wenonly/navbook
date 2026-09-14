import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';
import { LoadingOverlay } from './Feedback';

export function Table({ fixed, className, ...rest }: HTMLAttributes<HTMLTableElement> & { fixed?: boolean }) {
  // border-separate + 间距 0：单元格边框独立渲染，避免 collapse 下边框跟随滚动消失
  return (
    <table
      className={cx('w-full border-separate border-spacing-0 text-sm', fixed && 'table-fixed', className)}
      {...rest}
    />
  );
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx('border-b border-line bg-[#F9FAFC] px-3 py-2 text-left text-xs font-medium text-ink-faint', className)}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('border-b border-line px-3 py-2.5 align-middle', className)} {...rest} />;
}

interface TableCardProps {
  /** 列宽 px；0 = 弹性列。表头与表体是两个表格，靠相同 colgroup + table-fixed 对齐；
      弹性列放最后，吸收滚动条占宽，避免前面列的边界在表头/表体间错位 */
  cols: number[];
  /** 表头行 <tr>…</tr>，渲染在滚动区外（滚动条只出现在内容区域） */
  header: ReactNode;
  loading?: boolean;
  footer?: ReactNode;
  /** 表体行 */
  children: ReactNode;
}

export function TableCard({ cols, header, loading, footer, children }: TableCardProps) {
  const colgroup = (
    <colgroup>
      {cols.map((w, i) => <col key={i} style={w ? { width: w } : undefined} />)}
    </colgroup>
  );
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="shrink-0">
        <Table fixed>
          {colgroup}
          <thead>{header}</thead>
        </Table>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [&_tr:last-child_td]:border-b-0">
        <Table fixed>
          {colgroup}
          <tbody>{children}</tbody>
        </Table>
      </div>
      {loading && <LoadingOverlay />}
      {footer && <div className="shrink-0 border-t border-line px-4 py-2.5">{footer}</div>}
    </div>
  );
}
