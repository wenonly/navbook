import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

const field =
  'h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink ' +
  'placeholder:text-ink-faint focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-soft ' +
  'disabled:opacity-50';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(field, className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx(field, 'cursor-pointer', className)} {...rest} />;
}
