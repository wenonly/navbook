import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

export function Loading({ text = '加载中...' }: { text?: string }) {
  return <div className="py-16 text-center text-sm text-ink-faint">{text}</div>;
}

/** 悬浮在内容区上方的加载遮罩（表格翻页/首次加载时覆盖旧数据） */
export function LoadingOverlay({ text = '加载中...' }: { text?: string }) {
  return (
    <div data-testid="table-loading" className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80">
      <div className="flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 size={16} className="animate-spin text-primary" />
        {text}
      </div>
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-danger">{children}</p>;
}

export function SuccessNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-success">{children}</p>;
}
