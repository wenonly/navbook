import { useCallback, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useCategories, useDelCategory } from '@/api/hooks';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { CategoryDialog } from '@/components/admin/CategoryDialog';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { cn } from '@/lib/utils';
import { topsOf, type CategoryRow } from '@/lib/category-tree';

// 后端 category_list limit 上限 100；分类数远小于此，一次拉全量（不分页）
const FETCH_ALL = 100;

const col = createColumnHelper<CategoryRow>();

export function AdminCategories() {
  const { data, isFetching } = useCategories(1, FETCH_ALL);
  const del = useDelCategory();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editRow, setEditRow] = useState<CategoryRow | null>(null);
  const [delTarget, setDelTarget] = useState<CategoryRow | null>(null);

  const all: CategoryRow[] = data?.data ?? [];
  // v8 铁律：传给 useReactTable 的引用必须稳定。data 每次渲染新数组会在 React 19 下
  // 把整棵树的渲染调度搞挂（症状：离开本页后路由 URL 变了但视图冻结、无任何报错）
  const topRows = useMemo(() => topsOf(all), [all]);
  const subRowsOf = useCallback((row: CategoryRow) => all.filter(c => c.fid === row.id), [all]);

  const columns = useMemo(() => [
    col.accessor('id', {
      header: 'ID',
      cell: info => <span className="text-ink-faint">{info.getValue()}</span>,
    }),
    col.accessor('name', {
      header: '名称',
      // 父子渲染交给 TanStack 展开行模型：子行 depth>0 缩进；父行可收起（默认全展开）
      cell: ({ row, getValue }) => (
        <span
          className="flex items-center gap-1.5"
          style={row.depth > 0 ? { paddingLeft: `${1.25 + row.depth * 1.25}rem` } : undefined}
        >
          {row.getCanExpand() && (
            <button
              type="button"
              aria-label={row.getIsExpanded() ? '收起子分类' : '展开子分类'}
              onClick={row.getToggleExpandedHandler()}
              className="shrink-0 text-ink-faint transition-colors hover:text-ink"
            >
              <ChevronRight size={13} className={cn('transition-transform', row.getIsExpanded() && 'rotate-90')} />
            </button>
          )}
          <span className={row.depth === 0 ? 'font-medium text-ink' : 'text-ink'}>{getValue()}</span>
        </span>
      ),
    }),
    col.accessor('property', {
      header: '属性',
      cell: info => info.getValue() === 1
        ? <Badge variant="destructive">私有</Badge>
        : <Badge variant="secondary">公开</Badge>,
    }),
    col.accessor('weight', {
      header: '权重',
      cell: info => <span className="text-ink-secondary">{info.getValue()}</span>,
    }),
    col.display({
      id: 'actions',
      header: '操作',
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setEditRow(row.original); setDialogOpen(true); }}>
            编辑
          </Button>
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setDelTarget(row.original)}>
            删除
          </Button>
        </div>
      ),
    }),
  ], []);

  const table = useReactTable({
    // 树模式要求顶层只传父行：子行若同时出现在 data 顶层会重复渲染（React duplicate key）
    data: topRows,
    columns,
    getSubRows: subRowsOf,
    getRowId: row => String(row.id),
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    // 默认全展开（用户拍板：分组展示、默认展开；需要时可点箭头收起）
    initialState: { expanded: true },
  });

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
            {table.getHeaderGroups()[0].headers.map(header => (
              <TableHead key={header.id} className="sticky top-0 z-10 bg-row-hover">
                {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
              </TableHead>
            ))}
          </TableRow>
        }
        loading={isFetching}
      >
        {all.length === 0 && !isFetching ? (
          <TableRow>
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">暂无分类，点击右上角「新增分类」添加</TableCell>
          </TableRow>
        ) : (
          table.getRowModel().rows.map(row => (
            <TableRow
              key={row.id}
              className={row.depth === 0 && row.subRows.length > 0 ? 'bg-page' : ''}
            >
              {row.getVisibleCells().map(cell => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
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
