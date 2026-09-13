import type { ReactNode } from 'react';

export function Loading({ text = '加载中...' }: { text?: string }) {
  return <div className="py-16 text-center text-sm text-ink-faint">{text}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-danger">{children}</p>;
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-success">{children}</p>;
}
