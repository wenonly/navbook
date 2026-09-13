import type { HTMLAttributes } from 'react';
import { cx } from './cx';

type Tone = 'primary' | 'neutral' | 'success' | 'danger';

const tones: Record<Tone, string> = {
  primary: 'bg-primary-soft text-primary',
  neutral: 'bg-row-hover text-ink-secondary',
  success: 'bg-success-soft text-success',
  danger: 'bg-danger-soft text-danger',
};

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = 'neutral', className, ...rest }: Props) {
  return (
    <span
      className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}
      {...rest}
    />
  );
}
