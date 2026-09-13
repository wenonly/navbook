import { Button } from './Button';

/** 紧凑页码序列：首尾各留 1 页，当前页附近连续，其余折叠为省略号 */
function pageSeq(page: number, pageCount: number): Array<number | '...'> {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const gap = (n: number) => (Math.abs(n - page) < 2 || n === 1 || n === pageCount ? n : '...');
  return Array.from({ length: pageCount }, (_, i) => gap(i + 1)).filter(
    (n, i, arr) => n !== '...' || arr[i - 1] !== '...',
  );
}

interface Props {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pageCount, total, onChange }: Props) {
  if (pageCount <= 1) {
    return (
      <div className="py-3 text-xs text-ink-faint">共 {total} 条</div>
    );
  }
  return (
    <div className="mt-3 flex items-center justify-between">
      <span className="text-xs text-ink-faint">共 {total} 条 · 第 {page}/{pageCount} 页</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          上一页
        </Button>
        {pageSeq(page, pageCount).map((n, i) =>
          typeof n !== 'number' ? (
            <span key={`e${i}`} className="px-1 text-xs text-ink-faint">…</span>
          ) : (
            <Button
              key={n}
              size="sm"
              variant={n === page ? 'primary' : 'outline'}
              className={n === page ? 'pointer-events-none' : ''}
              onClick={() => onChange(n)}
            >
              {n}
            </Button>
          ),
        )}
        <Button size="sm" variant="outline" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          下一页
        </Button>
      </div>
    </div>
  );
}
