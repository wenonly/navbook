import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Bot } from 'lucide-react';
import { api } from '@/api/client';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';

interface Provider {
  id: string; name: string; preset: string;
  baseUrl: string; apiKey: string; model: string;
}
interface Preset { id: string; name: string; baseUrl: string; models: string[] }

export function AdminAiConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.aiConfig().then((res: any) => {
      setProviders(res.data.config.providers);
      setPresets(res.data.presets);
      setActiveId(res.data.config.activeProviderId);
      setSystemPrompt(res.data.config.systemPrompt ?? '');
    }).finally(() => setLoading(false));
  }, []);

  const patch = (id: string, p: Partial<Provider>) =>
    setProviders(prev => prev.map(x => (x.id === id ? { ...x, ...p } : x)));

  const applyPreset = (id: string, presetId: string) => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    patch(id, {
      preset: presetId,
      name: preset.name === '自定义' ? '自定义厂商' : preset.name,
      baseUrl: preset.baseUrl,
      model: preset.models[0] ?? '',
    });
  };

  const addProvider = () => {
    const id = crypto.randomUUID();
    setProviders(prev => [...prev, {
      id, name: '', preset: 'custom', baseUrl: '', apiKey: '', model: '',
    }]);
  };

  const removeProvider = (id: string) => {
    setProviders(prev => prev.filter(x => x.id !== id));
    if (activeId === id) setActiveId(null);   // 删的是当前厂商 → 清空选中,避免悬空引用
  };

  const save = async () => {
    try {
      await api.saveAiConfig({ providers, activeProviderId: activeId, systemPrompt });
      toast.success('已保存');
      const res: any = await api.aiConfig();
      setProviders(res.data.config.providers);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  if (loading) return null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="模型配置" subtitle="对接 OpenAI 兼容厂商,Key 仅管理员可见(回显打码,留打码值不变即不修改)" />

      {providers.map(p => (
        <Card key={p.id} className={activeId === p.id ? 'border-primary/60' : ''}>
          <CardContent className="grid gap-4 p-5">
            <div className="flex items-center gap-3">
              <Select value={p.preset} onValueChange={v => applyPreset(p.id, v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {presets.map(ps => (
                    <SelectItem key={ps.id} value={ps.id}>{ps.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="flex-1" placeholder="显示名称" value={p.name}
                onChange={e => patch(p.id, { name: e.target.value })} />
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="active-provider" checked={activeId === p.id}
                  onChange={() => setActiveId(p.id)} />当前
              </label>
              <Button variant="ghost" size="icon" onClick={() => removeProvider(p.id)}>
                <Trash2 size={16} className="text-destructive" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Base URL</Label>
                <Input value={p.baseUrl} placeholder="https://api.deepseek.com/v1"
                  onChange={e => patch(p.id, { baseUrl: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>模型名</Label>
                <Input value={p.model} placeholder="deepseek-chat" list={`models-${p.id}`}
                  onChange={e => patch(p.id, { model: e.target.value })} />
                <datalist id={`models-${p.id}`}>
                  {(presets.find(ps => ps.id === p.preset)?.models ?? []).map(m =>
                    <option key={m} value={m} />)}
                </datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>API Key</Label>
              <Input type="password" value={p.apiKey} placeholder="sk-..."
                onChange={e => patch(p.id, { apiKey: e.target.value })} />
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-3">
        <Button variant="outline" onClick={addProvider}><Plus size={16} />新增厂商</Button>
        <Button onClick={save}>
          <Save size={16} />保存配置
        </Button>
      </div>

      <Card>
        <CardContent className="space-y-2 p-5">
          <Label className="flex items-center gap-2"><Bot size={16} />系统提示词(可选,留空用默认)</Label>
          <textarea
            className="min-h-28 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
            placeholder="例如:你是我的书签导航站助手,回答保持简洁。"
          />
        </CardContent>
      </Card>
    </div>
  );
}
