import type { HTMLAttributes } from 'react';
import { cx } from './cx';

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'md';
}

export function Card({ padding = 'md', className, ...rest }: Props) {
  return (
    <div
      className={cx('rounded-xl border border-line bg-surface', padding === 'md' && 'p-5', className)}
      {...rest}
    />
  );
}
