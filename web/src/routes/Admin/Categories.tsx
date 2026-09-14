import { useEffect, useState } from 'react';
import { useCategories, useAddCategory, useEditCategory, useDelCategory } from '@/api/hooks';
import { Badge } from '@/components/legacy/Badge';
import { Button } from '@/components/legacy/Button';
import { Input } from '@/components/legacy/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Pagination } from '@/components/legacy/Pagination';
import { Th, Td, TableCard } from '@/components/legacy/Table';
import { ErrorNote } from '@/components/legacy/Feedback';

interface CategoryRow {
  id: number;
  name: string;
  property: number;
  weight: number;
  description: string | null;
  fontIcon: string | null;
  fid: number;
}

const PAGE_SIZE = 20;

export function AdminCategories() {
  const [page, setPage] = useState(1);
  const { data, isFetching } = useCategories(page, PAGE_SIZE);
  const add = useAddCategory();
  const edit = useEditCategory();
  const del = useDelCategory();

  const [name, setName] = useState('');
  const [editRow, setEditRow] = useState<CategoryRow | null>(null);
  const [error, setError] = useState('');

  // 删除末页最后一条后回退，避免停留在空页；count 未知（切换页码的加载间隙）不回退，
  // 否则 pageCount 被误算为 1，会把刚点的页码弹回第 1 页
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE_SIZE));
  useEffect(() => { if (data && page > pageCount) setPage(pageCount); }, [page, pageCount, data]);

  const cats: CategoryRow[] = data?.data ?? [];
  const total = data?.count ?? 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) return;
    try {
      // 编辑携带整行数据（category_list 返回 camelCase，fontIcon 提交时映射回 font_icon），
      // 只带 name 会把 property 等硬编码重置——property:0 会让私有分类对游客泄露其下链接
      const payload = editRow
        ? {
            id: editRow.id, name,
            property: editRow.property, weight: editRow.weight,
            description: editRow.description ?? '', font_icon: editRow.fontIcon ?? '',
            fid: editRow.fid,
          }
        : { name, property: 0, weight: 0, description: '', font_icon: '', fid: 0 };
      if (editRow) await edit.mutateAsync(payload);
      else await add.mutateAsync(payload);
      setEditRow(null);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="分类管理" />

      <form className="mb-4 flex gap-2" onSubmit={submit}>
        <Input
          placeholder="分类名称"
          value={name}
          onChange={e => setName(e.target.value)}
          className="w-64"
        />
        <Button type="submit" disabled={add.isPending || edit.isPending}>
          {editRow ? '更新' : '新增'}
        </Button>
        {editRow && (
          <Button variant="outline" onClick={() => { setEditRow(null); setName(''); }}>
            取消
          </Button>
        )}
      </form>
      {error && <div className="mb-2"><ErrorNote>{error}</ErrorNote></div>}

      <TableCard
        cols={[64, 360, 80, 80, 0]}
        header={
          <tr>
            <Th>ID</Th>
            <Th>名称</Th>
            <Th>属性</Th>
            <Th>权重</Th>
            <Th>操作</Th>
          </tr>
        }
        loading={isFetching}
        footer={<Pagination page={page} pageCount={pageCount} total={total} onChange={setPage} />}
      >
        {cats.length === 0 && !isFetching && (
          <tr>
            <Td colSpan={5} className="py-10 text-center text-ink-faint">暂无分类,使用上方表单添加</Td>
          </tr>
        )}
        {cats.map(c => (
          <tr key={c.id} className="transition-colors hover:bg-row-hover">
            <Td className="text-ink-faint">{c.id}</Td>
            <Td className="font-medium text-ink">{c.name}</Td>
            <Td>
              {c.property === 1
                ? <Badge tone="danger">私有</Badge>
                : <Badge tone="neutral">公开</Badge>}
            </Td>
            <Td className="text-ink-secondary">{c.weight}</Td>
            <Td>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => { setEditRow(c); setName(c.name); }}>
                  编辑
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger-soft hover:text-danger"
                  onClick={() => {
                    if (confirm(`删除分类「${c.name}」？`)) del.mutate(c.id);
                  }}
                >
                  删除
                </Button>
              </div>
            </Td>
          </tr>
        ))}
      </TableCard>
    </div>
  );
}
