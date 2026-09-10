import { useState } from 'react';
import { useCategories, useAddCategory, useEditCategory, useDelCategory } from '@/api/hooks';

export function AdminCategories() {
  const { data, isLoading } = useCategories();
  const add = useAddCategory();
  const edit = useEditCategory();
  const del = useDelCategory();

  const [name, setName] = useState('');
  const [editRow, setEditRow] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState('');

  if (isLoading) return <div>加载中...</div>;
  const cats: any[] = data?.data ?? [];

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
      <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>分类管理</h2>
      <form className="mb-4 flex gap-2" onSubmit={submit}>
        <input
          placeholder="分类名称"
          value={name}
          onChange={e => setName(e.target.value)}
          className="px-3 py-1 border rounded"
          style={{ borderColor: 'var(--color-border)' }}
        />
        <button
          type="submit"
          disabled={add.isPending || edit.isPending}
          className="px-4 py-1 rounded text-white disabled:opacity-50"
          style={{ background: 'var(--color-primary)' }}
        >
          {editRow ? '更新' : '新增'}
        </button>
        {editRow && (
          <button
            type="button"
            onClick={() => { setEditRow(null); setName(''); }}
            className="px-4 py-1 border rounded"
            style={{ borderColor: 'var(--color-border)' }}
          >
            取消
          </button>
        )}
      </form>
      {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
            <th className="text-left py-2">ID</th>
            <th className="text-left py-2">名称</th>
            <th className="text-left py-2">属性</th>
            <th className="text-left py-2">权重</th>
            <th className="text-left py-2">操作</th>
          </tr>
        </thead>
        <tbody>
          {cats.map(c => (
            <tr key={c.id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              <td className="py-2">{c.id}</td>
              <td className="py-2">{c.name}</td>
              <td className="py-2">{c.property === 1 ? '私有' : '公开'}</td>
              <td className="py-2">{c.weight}</td>
              <td className="py-2 space-x-2">
                <button className="text-blue-500" onClick={() => { setEditRow(c); setName(c.name); }}>
                  编辑
                </button>
                <button
                  className="text-red-500"
                  onClick={() => {
                    if (confirm(`删除分类「${c.name}」？`)) del.mutate(c.id);
                  }}
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
