import { useState } from 'react';
import { CornerDownRight, Plus } from 'lucide-react';
import { useCategories, useDelCategory } from '@/api/hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { CategoryDialog } from '@/components/admin/CategoryDialog';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { groupByParent, type CategoryRow } from '@/lib/category-tree';

// 后端 category_list limit 上限 100；分类数远小于此，一次拉全量分组展示（不分页）
const FETCH_ALL = 100;

export function AdminCategories() {
  const { data, isFetching } = useCategories(1, FETCH_ALL);
  const del = useDelCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CategoryRow | null>(null);
  const [delTarget, setDelTarget] = useState<CategoryRow | null>(null);

  const all: CategoryRow[] = data?.data ?? [];
  const rows = groupByParent(all);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="分类管理"
        subtitle={`共 ${all.length} 个分类，按父子分组展示`}
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
      >
        {rows.length === 0 && !isFetching && (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">暂无分类，点击右上角「新增分类」添加</TableCell>
          </TableRow>
        )}
        {rows.map(({ row: c, child }) => (
          <TableRow key={c.id} className={child ? '' : 'bg-page'}>
            <TableCell className="text-ink-faint">{c.id}</TableCell>
            <TableCell className={child ? 'py-1.5' : 'font-medium text-ink'}>
              {child && <CornerDownRight size={13} className="mr-1.5 inline-block shrink-0 text-ink-faint" />}
              {c.name}
            </TableCell>
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
        description="该操作不可撤销；有子分类或链接的分类无法删除。"
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
