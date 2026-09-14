import { Loader2 } from 'lucide-react';

/** 页面级加载占位（查询首屏） */
export function Loading({ text = '加载中...' }: { text?: string }) {
  return <div className="py-16 text-center text-sm text-ink-faint">{text}</div>;
}

/** 悬浮在表格内容区上方的加载遮罩（翻页/首载覆盖旧数据） */
export function TableLoadingOverlay({ text = '加载中...' }: { text?: string }) {
  return (
    <div data-testid="table-loading" className="absolute inset-0 z-20 flex items-center justify-center bg-surface/80">
      <div className="flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 size={16} className="animate-spin text-primary" />
        {text}
      </div>
    </div>
  );
}

/** 查询失败占位 */
export function LoadError({ children = '加载失败，请刷新重试' }: { children?: React.ReactNode }) {
  return <div className="py-16 text-center text-sm text-danger">{children}</div>;
}
