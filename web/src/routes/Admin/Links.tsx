import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useLinks, useDelLink } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { LetterAvatar } from '@/components/admin/LetterAvatar';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { LinkDialog, type LinkRow } from '@/components/admin/LinkDialog';
import { TablePagination } from '@/components/admin/TablePagination';

const PAGE_SIZE = 20;

export function AdminLinks() {
  const [page, setPage] = useState(1);
  const { data: linkData, isFetching } = useLinks(page, PAGE_SIZE);
  const del = useDelLink();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<LinkRow | null>(null);
  const [delTarget, setDelTarget] = useState<LinkRow | null>(null);

  // 删除末页最后一条后回退，避免停留在空页；count 未知（切换页码的加载间隙）不回退，
  // 否则 pageCount 被误算为 1，会把刚点的页码弹回第 1 页
  const pageCount = Math.max(1, Math.ceil((linkData?.count ?? 0) / PAGE_SIZE));
  useEffect(() => { if (linkData && page > pageCount) setPage(pageCount); }, [page, pageCount, linkData]);

  const links: LinkRow[] = linkData?.data ?? [];
  const total = linkData?.count ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="链接管理"
        right={
          <Button onClick={() => { setEditRow(null); setDialogOpen(true); }}>
            <Plus size={14} /> 新增链接
          </Button>
        }
      />

      <DataTableCard
        cols={[64, 260, 320, 128, 0]}
        headers={
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky top-0 z-10 bg-row-hover">ID</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">标题</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">URL</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">分类</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">操作</TableHead>
          </TableRow>
        }
        loading={isFetching}
        footer={<TablePagination page={page} pageCount={pageCount} total={total} onChange={setPage} />}
      >
        {links.length === 0 && !isFetching && (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">暂无链接，点击右上角「新增链接」添加</TableCell>
          </TableRow>
        )}
        {links.map(l => (
          <TableRow key={l.id}>
            <TableCell className="text-ink-faint">{l.id}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2.5">
                <LetterAvatar text={l.title} />
                <span className="font-medium text-ink">{l.title}</span>
              </div>
            </TableCell>
            <TableCell className="truncate font-mono text-xs text-ink-secondary">{l.url}</TableCell>
            <TableCell className="text-ink-secondary">{l.categoryName}</TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEditRow(l); setDialogOpen(true); }}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDelTarget(l)}>
                  删除
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <LinkDialog open={dialogOpen} onOpenChange={setDialogOpen} row={editRow} />
      <ConfirmDialog
        open={delTarget !== null}
        onOpenChange={v => { if (!v) setDelTarget(null); }}
        title={`删除链接「${delTarget?.title ?? ''}」？`}
        description="该操作不可撤销。"
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (!delTarget) return;
          del.mutate(delTarget.id, {
            onSuccess: () => toast.success('链接已删除'),
            onError: e => toast.error(e instanceof Error ? e.message : '删除失败'),
          });
          setDelTarget(null);
        }}
      />
    </div>
  );
}
