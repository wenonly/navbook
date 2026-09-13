import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cx } from './cx';

export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cx('w-full border-collapse text-sm', className)} {...rest} />;
}

export function Th({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cx('border-b border-line px-3 py-2 text-left text-xs font-medium text-ink-faint', className)}
      {...rest}
    />
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cx('border-b border-line px-3 py-2.5 align-middle', className)} {...rest} />;
}
