import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';
import { LoadingOverlay } from './Feedback';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  // border-separate + 间距 0：让 sticky 表头的边框在滚动时不消失（collapse 会跟着滚走）
  return <table className={cx('w-full border-separate border-spacing-0 text-sm', className)} {...rest} />;
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
  loading?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/** 表格卡片：内容超出时表格区域内部滚动（sticky 表头），footer 固定在卡片底部 */
export function TableCard({ loading, footer, children }: TableCardProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_tr:last-child_td]:border-b-0">
        {children}
      </div>
      {loading && <LoadingOverlay />}
      {footer && <div className="shrink-0 border-t border-line px-4 py-2.5">{footer}</div>}
    </div>
  );
}
