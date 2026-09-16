import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Save, Bot, Globe } from 'lucide-react';
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
interface McpServer {
  id: string; name: string; url: string; apiKey: string; trust: 'confirm' | 'auto';
}

export function AdminAiConfig() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.aiConfig().then((res: any) => {
      setProviders(res.data.config.providers);
      setPresets(res.data.presets);
      setActiveId(res.data.config.activeProviderId);
      setSystemPrompt(res.data.config.systemPrompt ?? '');
      setMcpServers(res.data.config.mcpServers ?? []);
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

  const patchMcp = (id: string, p: Partial<McpServer>) =>
    setMcpServers(prev => prev.map(x => (x.id === id ? { ...x, ...p } : x)));

  const addMcp = () => {
    if (mcpServers.length >= 5) return;
    setMcpServers(prev => [...prev, { id: crypto.randomUUID(), name: '', url: '', apiKey: '', trust: 'confirm' }]);
  };

  const save = async () => {
    try {
      await api.saveAiConfig({ providers, activeProviderId: activeId, systemPrompt, mcpServers });
      toast.success('已保存');
      const res: any = await api.aiConfig();
      setProviders(res.data.config.providers);
      setMcpServers(res.data.config.mcpServers ?? []);
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
        <CardContent className="space-y-4 p-5">
          <div className="space-y-0.5">
            <Label className="flex items-center gap-2"><Globe size={16} />MCP 服务器(Streamable HTTP)</Label>
            <p className="text-xs text-muted-foreground">
              接入外部工具生态(联网搜索/读网页等),最多 5 个。示例:Tavily(key 拼在 URL 里、信任选「只读免确认」);智谱/Perplexity(Key 填 API Key,走 Bearer)。「需确认」的工具执行前会出确认卡。
            </p>
          </div>
          {mcpServers.map(s => (
            <div key={s.id} className="grid gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center gap-3">
                <Input className="w-44" placeholder="名称,如 Tavily" value={s.name}
                  onChange={e => patchMcp(s.id, { name: e.target.value })} />
                <Select value={s.trust} onValueChange={v => patchMcp(s.id, { trust: v as McpServer['trust'] })}>
                  <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirm">需确认</SelectItem>
                    <SelectItem value="auto">只读免确认</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() =>
                  setMcpServers(prev => prev.filter(x => x.id !== s.id))}>
                  <Trash2 size={16} className="text-destructive" />
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>端点 URL</Label>
                <Input value={s.url} placeholder="https://mcp.tavily.com/mcp/?tavilyApiKey=…"
                  onChange={e => patchMcp(s.id, { url: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>API Key(留空 = 不发送,适合 key 拼在 URL 里的服务器)</Label>
                <Input type="password" value={s.apiKey} placeholder="Bearer Token,可留空"
                  onChange={e => patchMcp(s.id, { apiKey: e.target.value })} />
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addMcp} disabled={mcpServers.length >= 5}>
            <Plus size={14} />添加 MCP 服务器
          </Button>
        </CardContent>
      </Card>

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
