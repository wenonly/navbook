import { useEffect, useState } from 'react';
import { CornerDownRight, Plus, Search, X } from 'lucide-react';
import { useAllCategories, useLinks, useDelLink } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TableCell, TableHead, TableRow } from '@/components/ui/table';
import { PageHeader } from '@/components/ui/PageHeader';
import { LetterAvatar } from '@/components/admin/LetterAvatar';
import { ConfirmDialog } from '@/components/admin/ConfirmDialog';
import { DataTableCard } from '@/components/admin/DataTableCard';
import { LinkDialog, type LinkRow } from '@/components/admin/LinkDialog';
import { TablePagination } from '@/components/admin/TablePagination';
import { topsOf, type CategoryRow } from '@/lib/category-tree';

const PAGE_SIZE = 20;

/** 'all' = 不筛选；分类为字符串以配合 Select value（shadcn Select 不接受空串值） */
const CAT_ALL = 'all';
const PROP_ALL = 'all';

export function AdminLinks() {
  const [page, setPage] = useState(1);
  // 搜索：input 即时态 + 防抖 300ms 提交态（回车立即提交）
  const [search, setSearch] = useState('');
  const [keyword, setKeyword] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setKeyword(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const commitSearch = () => setKeyword(search.trim());

  const [catFilter, setCatFilter] = useState(CAT_ALL);
  const [propFilter, setPropFilter] = useState(PROP_ALL);
  const hasFilter = keyword !== '' || catFilter !== CAT_ALL || propFilter !== PROP_ALL;

  // 筛选变化回到第 1 页（含挂载时一次无害的 setPage(1)）
  useEffect(() => { setPage(1); }, [keyword, catFilter, propFilter]);

  const { data: linkData, isFetching } = useLinks(page, PAGE_SIZE, {
    ...(keyword ? { keyword } : {}),
    ...(catFilter !== CAT_ALL ? { categoryId: Number(catFilter) } : {}),
    ...(propFilter === 'public' ? { property: 0 } : propFilter === 'private' ? { property: 1 } : {}),
  });
  const { data: catData } = useAllCategories();
  const allCats: CategoryRow[] = catData?.data ?? [];
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

  function resetFilters() {
    setSearch('');
    setCatFilter(CAT_ALL);
    setPropFilter(PROP_ALL);
  }

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

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative w-64 max-w-full">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter') commitSearch(); }}
            placeholder="搜索标题 / URL / 描述"
            aria-label="搜索链接"
            className="pl-8 pr-8"
          />
          {search !== '' && (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => { setSearch(''); setKeyword(''); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-ink-faint hover:bg-row-hover hover:text-ink"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-44" aria-label="按分类筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={CAT_ALL}>全部分类</SelectItem>
            {topsOf(allCats).flatMap(top => [
              // 层级展示与 LinkDialog 分类下拉一致：父分类平铺，子项 ↳ 图标
              <SelectItem key={top.id} value={String(top.id)}>{top.name}</SelectItem>,
              ...allCats.filter(c => c.fid === top.id).map(sub => (
                <SelectItem key={sub.id} value={String(sub.id)}>
                  <span className="inline-flex items-center gap-1">
                    <CornerDownRight size={12} className="text-ink-faint" />
                    {sub.name}
                  </span>
                </SelectItem>
              )),
            ])}
          </SelectContent>
        </Select>

        <Select value={propFilter} onValueChange={setPropFilter}>
          <SelectTrigger className="w-28" aria-label="按属性筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PROP_ALL}>全部属性</SelectItem>
            <SelectItem value="public">公开</SelectItem>
            <SelectItem value="private">私有</SelectItem>
          </SelectContent>
        </Select>

        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>重置</Button>
        )}
      </div>

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
            <TableCell colSpan={5} className="py-10 text-center text-ink-faint">
              {hasFilter ? '没有匹配的链接，试试调整搜索词或筛选条件' : '暂无链接，点击右上角「新增链接」添加'}
            </TableCell>
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
