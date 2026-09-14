import { useEffect, useState } from 'react';
import { useAddCategory, useEditCategory, useCategories } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { topsOf, type CategoryRow } from '@/lib/category-tree';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入 = 编辑模式，回填整行 */
  row?: CategoryRow | null;
}

export function CategoryDialog({ open, onOpenChange, row }: Props) {
  const add = useAddCategory();
  const edit = useEditCategory();
  const pending = add.isPending || edit.isPending;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [weight, setWeight] = useState('0');
  const [fontIcon, setFontIcon] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [fid, setFid] = useState('0');

  const { data: catData } = useCategories(1, 100);
  const allCats: CategoryRow[] = catData?.data ?? [];

  // 打开时按模式重置：编辑回填整行，新增清空
  useEffect(() => {
    if (!open) return;
    if (row) {
      setName(row.name);
      setDescription(row.description ?? '');
      setWeight(String(row.weight ?? 0));
      setFontIcon(row.fontIcon ?? '');
      setIsPrivate(row.property === 1);
      setFid(String(row.fid ?? 0));
    } else {
      setName(''); setDescription(''); setWeight('0'); setFontIcon(''); setIsPrivate(false); setFid('0');
    }
  }, [open, row]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('分类名称必填');
      return;
    }
    // 编辑携带整行数据：只带 name 会把 property 等硬编码重置，
    // property:0 会让私有分类对游客泄露其下链接
    const payload = {
      ...(row ? { id: row.id } : {}),
      name: name.trim(),
      description: description.trim(),
      weight: Number(weight) || 0,
      font_icon: fontIcon.trim(),
      property: isPrivate ? 1 : 0,
      fid: Number(fid) || 0,
    };
    try {
      if (row) {
        await edit.mutateAsync(payload);
        toast.success('分类已更新');
      } else {
        await add.mutateAsync(payload);
        toast.success('分类已创建');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? '编辑分类' : '新增分类'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">名称 *</Label>
            <Input id="cat-name" value={name} onChange={e => setName(e.target.value)} placeholder="分类名称" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-desc">描述</Label>
            <Input id="cat-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="描述（可选）" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cat-weight">权重</Label>
              <Input id="cat-weight" type="number" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat-icon">图标 class</Label>
              <Input id="cat-icon" value={fontIcon} onChange={e => setFontIcon(e.target.value)} placeholder="如 fa fa-star" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cat-fid">父分类</Label>
            {/* 后端规则：父分类不能是二级分类 → 候选只列顶级（排除自己）。
                低频字段用原生 select：够用且规避焦点管理复杂度；链接的主字段才用 Radix Select */}
            <select
              id="cat-fid"
              value={fid}
              onChange={e => setFid(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="0">无（顶级分类）</option>
              {topsOf(allCats).filter(c => c.id !== row?.id).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
            <div>
              <Label htmlFor="cat-private">私有分类</Label>
              <p className="text-xs text-ink-faint">仅登录后可见，游客不可见其下链接</p>
            </div>
            <Switch id="cat-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={pending}>{pending ? '提交中...' : row ? '更新' : '新增'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
