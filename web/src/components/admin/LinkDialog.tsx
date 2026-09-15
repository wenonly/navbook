import { useEffect, useState } from 'react';
import { CornerDownRight } from 'lucide-react';
import { useAddLink, useEditLink, useAllCategories } from '@/api/hooks';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { topsOf, type CategoryRow } from '@/lib/category-tree';

/** link_list 返回行（camelCase，见 workers handlers/link.ts LinkRow）；提交映射回 snake_case */
export interface LinkRow {
  id: number;
  fid: number;
  title: string;
  url: string;
  description: string | null;
  weight: number;
  property: number;
  urlStandby: string | null;
  fontIcon: string | null;
  categoryName?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 传入 = 编辑模式，回填整行（此前页面无编辑功能，这是补齐的能力） */
  row?: LinkRow | null;
}

export function LinkDialog({ open, onOpenChange, row }: Props) {
  const add = useAddLink();
  const edit = useEditLink();
  const pending = add.isPending || edit.isPending;
  const { data: catData } = useAllCategories();
  const allCats: CategoryRow[] = catData?.data ?? [];

  const [fid, setFid] = useState('0');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [urlStandby, setUrlStandby] = useState('');
  const [description, setDescription] = useState('');
  const [fontIcon, setFontIcon] = useState('');
  const [weight, setWeight] = useState('0');
  const [isPrivate, setIsPrivate] = useState(false);

  // 打开时按模式重置：编辑回填整行，新增清空
  useEffect(() => {
    if (!open) return;
    if (row) {
      setFid(String(row.fid));
      setTitle(row.title);
      setUrl(row.url);
      setUrlStandby(row.urlStandby ?? '');
      setDescription(row.description ?? '');
      setFontIcon(row.fontIcon ?? '');
      setWeight(String(row.weight ?? 0));
      setIsPrivate(row.property === 1);
    } else {
      setFid('0'); setTitle(''); setUrl(''); setUrlStandby('');
      setDescription(''); setFontIcon(''); setWeight('0'); setIsPrivate(false);
    }
  }, [open, row]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!fid || fid === '0') { toast.error('请选择分类'); return; }
    if (!title.trim()) { toast.error('标题必填'); return; }
    if (!url.trim()) { toast.error('URL 必填'); return; }
    const payload = {
      ...(row ? { id: row.id } : {}),
      fid: Number(fid),
      title: title.trim(),
      url: url.trim(),
      url_standby: urlStandby.trim(),
      description: description.trim(),
      weight: Number(weight) || 0,
      property: isPrivate ? 1 : 0,
      font_icon: fontIcon.trim(),
    };
    try {
      if (row) {
        await edit.mutateAsync(payload);
        toast.success('链接已更新');
      } else {
        await add.mutateAsync(payload);
        toast.success('链接已创建');
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '操作失败');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{row ? '编辑链接' : '新增链接'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>分类 *</Label>
            <Select value={fid} onValueChange={setFid}>
              <SelectTrigger>
                <SelectValue placeholder="选择分类" />
              </SelectTrigger>
              <SelectContent>
                {topsOf(allCats).flatMap(top => [
                  // 父分类是可选项（链接可直接挂父分类），不再加 SelectLabel 分组标题——
                  // 否则父分类名会以「标题 + 选项」出现两次；层级由子项 ↳ 图标表达
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
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-title">标题 *</Label>
            <Input id="link-title" value={title} onChange={e => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-url">URL *</Label>
            <Input id="link-url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-standby">备用 URL</Label>
            <Input id="link-standby" value={urlStandby} onChange={e => setUrlStandby(e.target.value)} placeholder="https://...（可选）" className="font-mono text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-desc">描述</Label>
            <Input id="link-desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="描述（可选）" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="link-weight">权重</Label>
              <Input id="link-weight" type="number" value={weight} onChange={e => setWeight(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="link-icon">图标 class</Label>
              <Input id="link-icon" value={fontIcon} onChange={e => setFontIcon(e.target.value)} placeholder="如 fa fa-star" />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5">
            <div>
              <Label htmlFor="link-private">私有链接</Label>
              <p className="text-xs text-ink-faint">仅登录后可见</p>
            </div>
            <Switch id="link-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
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
