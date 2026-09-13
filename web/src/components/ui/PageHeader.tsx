import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}

export function PageHeader({ title, subtitle, right }: Props) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-[13px] text-ink-secondary">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
