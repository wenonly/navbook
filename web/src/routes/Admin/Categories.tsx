import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCategories, useDelCategory } from '@/api/hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { CategoryDialog, type CategoryRow } from '@/components/admin/CategoryDialog';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { TablePagination } from '@/components/admin/TablePagination';

const PAGE_SIZE = 20;

export function AdminCategories() {
  const [page, setPage] = useState(1);
  const { data, isFetching } = useCategories(page, PAGE_SIZE);
  const del = useDelCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CategoryRow | null>(null);
  const [delTarget, setDelTarget] = useState<CategoryRow | null>(null);

  // 删除末页最后一条后回退，避免停留在空页；count 未知（切换页码的加载间隙）不回退，
  // 否则 pageCount 被误算为 1，会把刚点的页码弹回第 1 页
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE));
  useEffect(() => { if (data && page > pageCount) setPage(pageCount); }, [page, pageCount, data]);

  const cats: CategoryRow[] = data?.data ?? [];
  const total = data?.count ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="分类管理"
        right={
          <Button onClick={() => { setEditRow(null); setDialogOpen(true); }}>
            <Plus size={14} /> 新增分类
          </Button>
        }
      />

      <DataTableCard
        cols={[64, 360, 80, 80, 0]}
        headers={
          <TableRow className="hover:bg-transparent">
            <TableHead className="sticky top-0 z-10 bg-row-hover">ID</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">名称</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">属性</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">权重</TableHead>
            <TableHead className="sticky top-0 z-10 bg-row-hover">操作</TableHead>
          </TableRow>
        }
        loading={isFetching}
        footer={<TablePagination page={page} pageCount={pageCount} total={total} onChange={setPage} />}
      >
        {cats.length === 0 && !isFetching && (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">暂无分类，点击右上角「新增分类」添加</TableCell>
          </TableRow>
        )}
        {cats.map(c => (
          <TableRow key={c.id}>
            <TableCell className="text-ink-faint">{c.id}</TableCell>
            <TableCell className="font-medium text-ink">{c.name}</TableCell>
            <TableCell>
              {c.property === 1
                ? <Badge variant="destructive">私有</Badge>
                : <Badge variant="secondary">公开</Badge>}
            </TableCell>
            <TableCell className="text-ink-secondary">{c.weight}</TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEditRow(c); setDialogOpen(true); }}>
                  编辑
                </Button>
                <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDelTarget(c)}>
                  删除
                </Button>
              </div>
            </TableCell>
          </TableRow>
        ))}
      </DataTableCard>

      <CategoryDialog open={dialogOpen} onOpenChange={setDialogOpen} row={editRow} />
      <ConfirmDialog
        open={delTarget !== null}
        onOpenChange={v => { if (!v) setDelTarget(null); }}
        title={`删除分类「${delTarget?.name ?? ''}」？`}
        description="该操作不可撤销，其下链接将失去分类归属。"
        confirmText="删除"
        destructive
        onConfirm={() => {
          if (!delTarget) return;
          del.mutate(delTarget.id, {
            onSuccess: () => toast.success('分类已删除'),
            onError: e => toast.error(e instanceof Error ? e.message : '删除失败'),
          });
          setDelTarget(null);
        }}
      />
    </div>
  );
}
