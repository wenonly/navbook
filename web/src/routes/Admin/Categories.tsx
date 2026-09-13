import { useState } from 'react';
import { useCategories, useAddCategory, useEditCategory, useDelCategory } from '@/api/hooks';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Table, Th, Td } from '@/components/ui/Table';
import { ErrorNote, Loading } from '@/components/ui/Feedback';

interface CategoryRow {
  id: number;
  name: string;
  property: number;
  weight: number;
  description: string | null;
  fontIcon: string | null;
  fid: number;
}

export function AdminCategories() {
  const { data, isLoading } = useCategories();
  const add = useAddCategory();
  const edit = useEditCategory();
  const del = useDelCategory();

  const [name, setName] = useState('');
  const [editRow, setEditRow] = useState<CategoryRow | null>(null);
  const [error, setError] = useState('');

  if (isLoading) return <Loading />;
  const cats: CategoryRow[] = data?.data ?? [];

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
    <div>
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

      <Table>
        <thead>
          <tr>
            <Th className="w-16">ID</Th>
            <Th>名称</Th>
            <Th className="w-20">属性</Th>
            <Th className="w-20">权重</Th>
            <Th className="w-28">操作</Th>
          </tr>
        </thead>
        <tbody>
          {cats.length === 0 && (
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
        </tbody>
      </Table>
    </div>
  );
}
