# AI 助手接入远程 MCP(搜索/外部能力)

日期:2026-09-16
状态:已实施(2026-09-16,commit 4741667/8398ef6/566a69c;§9 测试策略全部落地,223 测试全绿)
前置:2026-09-15-ai-assistant-design.md(本文在其工具体系上扩展)

## 1. 背景与目标

让 AI 助手具备联网搜索、读网页、调外部 API 的能力(类似 Claude 的工具生态)。方案:**通用远程 MCP 接入**——后台配置 MCP 服务器列表,agent 回合开始时自动发现工具(`initialize` + `tools/list`)、并入 OpenAI tools 数组,模型调用时转发 `tools/call`。以后接任何新能力零代码改动。

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 传输协议 | **仅 Streamable HTTP**(协议 `2025-03-26`)——Worker 跑不了 stdio 子进程,本地 MCP 不可行 |
| 接入方式 | 通用 MCP 客户端 + 后台可配服务器列表,而非硬编码某家搜索 API |
| 工具发现 | 每回合开始动态发现,结果**模块级缓存 10 分钟**(isolate 内跨请求复用;稳态回合零发现开销,省 Free 版 50 子请求/次预算) |
| 信任模型 | 每服务器二选一:`confirm`(工具视为写操作,执行前出确认卡)/ `auto`(视为只读直接执行) |
| 工具命名 | `mcp_<服务器slug>_<工具slug>`,前缀防与内置工具冲突,截断 ≤64(OpenAI 上限) |
| 批量 | MCP 工具**不可进 batch_write**(BATCH_ACTIONS 保持静态白名单) |
| 失败语义 | 单服务器发现失败只 warn 名称后跳过,绝不炸回合;工具调用错误作为错误 tool result 喂回模型自愈 |
| 密钥安全 | 错误信息与日志**绝不包含 URL 与 key**(Tavily 把 key 拼在 URL 里) |

### 已核实的远程 MCP 服务商

| 服务商 | 端点 | 鉴权 | 备注 |
|---|---|---|---|
| Tavily | `https://mcp.tavily.com/mcp/?tavilyApiKey=<key>` | key 拼 URL query | 免费 1000 次/月;**无状态服务器**(无 session,initialize 可失败仍可用) |
| 智谱 BigModel | 联网搜索 / 网页读取 MCP 端点 | `Authorization: Bearer <key>` | GLM Coding Plan 内含额度 |
| 阿里云百炼 | 应用级 MCP 端点 | Bearer | 按量计费 |
| Perplexity |官方 MCP 端点 | Bearer | 含搜索额度 |
| Bocha | open-web-search-mcp | Bearer | 国内搜索 |

(具体端点 URL 以各厂商文档为准,实施时在后台 UI 提示文案中给出 Tavily/智谱示例即可。)

## 3. 总体架构

```
web /admin/ai-config                后台配置 MCP 服务器(≤5 个)
        │ POST /api/ai_config (mcpServers 随 s_ai 整体保存)
        ▼
workers s_ai.mcpServers ──► router.ts ai_chat:
        │                    cfg.mcpServers.length ? new McpRegistry(cfg.mcpServers) : 不注入(现状)
        ▼
workers/src/ai/mcp.ts(新)
  McpRegistry.resolveTools()  并发发现+缓存 ──► AiTool[] wrapper
  McpClient                    Streamable HTTP JSON-RPC(initialize/tools/call)
        ▼
agent.ts: resolveTool = findTool ?? mcpByName  →  tools 数组合并下发模型
```

- `workers/src/ai/mcp.ts` 为唯一新模块;`agent.ts` 最小改动(4 处原位替换);`tools.ts` 不动
- 遵循现有惯例:Zod schema 入 `lib/validate.ts`;配置读写入 `ai/config.ts`;UI 入 web AiConfig.tsx

## 4. MCP 协议细节(Streamable HTTP 最小客户端)

### 请求

每次 POST 单条 JSON-RPC 到服务器端点,请求头:

```
content-type: application/json
accept: application/json, text/event-stream     ← 两种都要
mcp-protocol-version: 2025-03-26
mcp-session-id: <initialize 返回的会话头,可缺省>
authorization: Bearer <apiKey>                  ← apiKey 为空串时不发(Tavily key-in-URL 场景)
```

### 方法

| 方法 | 说明 |
|---|---|
| `initialize` | `{protocolVersion, capabilities:{}, clientInfo:{name:'navbook-ai', version:'1.0'}}`;从**响应头**捕获 `mcp-session-id`(没有 = 无状态服务器,容忍);失败不 fatal——继续尝试 listTools |
| `notifications/initialized` | 无 id 通知;响应 202;错误一律吞掉 |
| `tools/list` | cursor 分页(`nextCursor`),**封顶 20 个工具**;`inputSchema` 非对象兜底 `{type:'object'}` |
| `tools/call` | `{name, arguments}`;`isError:true` → throw;拍平 `content[]` |

### 响应双形态解析(关键)

POST 的响应 content-type 可能是 `application/json`(单条)也可能是 `text/event-stream`(SSE 帧)。rpc() 里按 content-type 分派:

- JSON → `res.json()`
- SSE → 行缓冲读帧,取**首个 JSON-RPC 响应**(`result` 或 `error` 字段),忽略注释行与通知帧,读完 `reader.cancel()` 释放连接(仿 provider.ts 的行缓冲实现)

### 结果拍平与截断

`tools/call` 结果:

- `content[]` 中 `type:'text'` 的 `text` 用 `\n` 连接;非文本部分以 `[<type> 内容]` 占位
- 无 content 或全非文本但有 `structuredContent` → `JSON.stringify(structuredContent)` 兜底
- 最终文本 **截断 16KB**(防撑爆模型上下文)
- `isError` → throw `MCP 工具返回错误:<首行200字>`

### 错误与超时

- 非 2xx → `MCP 服务器(<名称>)响应 HTTP <status>`;JSON-RPC `error` → `MCP 服务器(<名称>)错误 <code>:<message>`;**错误串只带服务器显示名,绝不带 URL/key**
- 超时:list 类 20s、call 40s(`AbortSignal.timeout`,独立于回合 180s 兜底信号);超时错误文案含「超时」
- `fetchFn` 构造器注入,默认 `fetch.bind(globalThis)`(provider.ts Illegal invocation 教训)

## 5. McpRegistry(工具发现与包装)

```ts
resolveTools(): Promise<AiTool[]>
```

- 模块级缓存 `Map<key, {tools, sessionId, fetchedAt}>`,key = `${id}:${url}:${apiKey.length}`,TTL 10 分钟;命中零 fetch,execute 复用缓存里带 session 的 client(确认续跑是新 HTTP 请求,不重握手)
- 未命中:`new McpClient` → `initialize()`(尽力而为)→ `listTools()` → 写缓存
- 多服务器 `Promise.allSettled` 并发;失败 `console.warn('[mcp] <名称> 工具发现失败')`(仅名称)后跳过
- 包装为 AiTool:
  - `name = mcp_<slug(服务器名)||'srv'>_<slug(工具名)||'tool'>`,截断 ≤64,Set 去重 `_2` 后缀(基名预留后缀空间再截,防二次碰撞)
  - `danger = trust==='auto' ? 'read' : 'write'`
  - `summarize(args, null)` → `调用外部工具 <tool>(<server>)`;`summarize(args, result)` → `调用 <tool>(<server>):<结果首行80字>`
  - `execute = (_db, args) => client.callTool(原始工具名, args)`(db 不用,外部调用)
- 上限:服务器 ≤5(校验层)、每服务器工具 ≤20(客户端层)

## 6. 数据模型与校验

### s_ai 新增 `mcpServers` 数组(存储态,apiKey 明文,先例同 providers)

```json
{
  "providers": [...],
  "activeProviderId": "p_xxx",
  "systemPrompt": "",
  "mcpServers": [
    { "id": "m_xxx", "name": "Tavily 搜索",
      "url": "https://mcp.tavily.com/mcp/?tavilyApiKey=tvly-xxx",
      "apiKey": "",
      "trust": "auto" }
  ]
}
```

- `McpServerConfig { id, name, url, apiKey:'', trust:'confirm'|'auto' }`
- `apiKey` 空串 = 不发 Authorization 头(key 拼 URL 的服务器);非空 = Bearer 头

### Zod(`lib/validate.ts` 新增 `aiMcpServerSchema`)

- `url`:`z.url().max(2048)`(**必须允许长 URL——Tavily key 拼在里面**)
- `name`:非空、≤50;`id`:非空
- `apiKey`:≤512,默认 `''`,允许打码占位回传
- `trust`:enum,默认 `confirm`
- `aiConfigSchema.mcpServers: z.array(...).max(5).optional().default([])`

### config.ts 三处必改(读/打码/合并)

1. **`loadAiConfig` 逐字段重建,未显式读的字段会被丢弃**——mcpServers 必须显式读:数组逐条过滤畸形(缺 id/name/url 丢弃)、截 5、`trust` 非法回落 `confirm`、`apiKey` 非串回落 `''`
2. **`maskKey('')` 返回 `'sk-***'` 而非空串**——maskConfig 对 mcpServers 加空串守卫:`s.apiKey ? maskKey(s.apiKey) : ''`,否则 key-in-URL 服务器会经 mergeMaskedKeys 写回垃圾占位值
3. `mergeMaskedKeys` 加 `mcpById` 映射(与 providers 同 `includes('***')` 逻辑:占位沿用原值,真新值覆盖);`DEFAULT_AI_CONFIG.mcpServers = []`

## 7. agent.ts 集成(最小改动,4 处原位替换)

`AgentDeps` 加可选 `mcp?: McpRegistry`(缺省 = 现状逐字节一致,测试可注入 Fake)。

`runAgentTurn` 内,`resolveActiveProvider` 成功之后、**`opts.confirm` 块之前**(坑:确认续跑是全新 HTTP 请求,approve 时需要已解析好的 MCP wrapper 才能执行工具):

```ts
const mcpTools = deps.mcp ? await deps.mcp.resolveTools() : [];
const mcpByName = new Map(mcpTools.map(t => [t.name, t]));
const resolveTool = (name: string) => findTool(name) ?? mcpByName.get(name);
const tools = [...toolSpecs(), ...mcpTools.map(t => ({
  type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters },
}))];
const systemPrompt = (cfg.systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT)
  + (mcpTools.length ? '\n另有外部工具(名称 mcp_ 前缀)来自 MCP 服务器,按其描述与参数调用;失败或为空时如实告知。' : '');
```

替换点:

| 位置 | 原 | 改 |
|---|---|---|
| confirm 块内找工具 | `findTool(c.name)` | `resolveTool(c.name)` |
| 循环内执行工具 | `findTool(call.name)` | `resolveTool(call.name)` |
| system 消息 | `cfg.systemPrompt?.trim() \|\| DEFAULT_SYSTEM_PROMPT` | 上面的 `systemPrompt` |
| streamChat 参数 | `tools: toolSpecs()` | `tools` |

`execTool` 不动(wrapper 完整实现 AiTool 接口);`tools.ts` 不动。

### router.ts ai_chat

```ts
await runAgentTurn({ db, provider: new OpenAiCompatProvider(),
  ...(cfg.mcpServers.length ? { mcp: new McpRegistry(cfg.mcpServers) } : {}) }, cfg, {...});
```

未配置 MCP 时不实例化 Registry,行为与现状完全一致。

## 8. 前端(web AiConfig.tsx)

厂商卡与系统提示词卡之间新增 Card:**「MCP 服务器(Streamable HTTP)」**

- 提示文案:接入外部工具生态(联网搜索/读网页等);最多 5 个;示例 Tavily(key 拼 URL、trust 选只读免确认)与智谱(key 填 Bearer);「需确认」的工具执行前会出确认卡
- 每行字段:名称 / URL(placeholder `mcp.tavily.com/mcp/?tavilyApiKey=…`)/ API Key 密码框(留空不发送;回显打码占位)/ trust Select(`需确认` | `只读免确认`)/ 删除按钮
- 「添加 MCP 服务器」按钮,5 个封顶
- state `mcpServers`;load 读 `res.data.config.mcpServers ?? []`;save payload 加 `mcpServers`

## 9. 测试策略

### 新 `workers/tests/ai/mcp.test.ts`(纯 fetch 注入仿 provider.test.ts,无 D1)

- 握手:initialize 带协议版本/clientInfo;响应头 `mcp-session-id` 捕获后后续请求回带
- 双形态:同一条 tools/call 分别以 `application/json` 与 `text/event-stream` 响应,解析结果一致
- inputSchema 非对象/缺失 → `{type:'object'}` 兜底
- 拍平:多 text 用 `\n` 连接;非文本 `[image 内容]`;structuredContent 兜底;>16KB 截断标记
- 错误:`isError`、JSON-RPC error、HTTP 401 → 中文错误信息且**断言不含 URL 与 key 字样**
- 超时:fetch 注入永不 resolve + 短超时 → 错误含「超时」
- 无状态服务器:initialize 失败(网络错)仍可 listTools 成功
- Registry:命名清洗(中文名/特殊字符→slug,空名回落 srv)、≤64、每服务器 ≤20、`_2` 去重、trust→danger 映射、缓存命中后第二次 resolveTools 不再发 initialize/list(captured 请求数不变)

### agent.test.ts

- `FakeProvider.streamChat` 增记 `tools` 参数(向后兼容,老用例不断言)
- 新 describe 直构 `runAgentTurn({db, provider, mcp: registry}, ...)`(绕过 collectEvents 的类型辅助):
  - auto 信任:模型调 `mcp_x_y` → 直接执行(无确认卡)→ 结果喂回下一轮 → system 首消息含 MCP 提示行
  - confirm 信任:出 `confirm_required` 且**未发 tools/call**;approve 后(新回合重新 resolveTools)执行成功并续跑
  - 全部服务器发现失败 → 退化为 12 个内置工具,无 error 事件
- fixtures 补 `mcpServers: []`:EMPTY_CFG / NO_PROVIDER_CFG

### config.test.ts

- mcpServers 保存后读回;maskConfig 打码 apiKey、**空串保持空串**(maskKey('') 坑回归)
- mergeMaskedKeys 按 id 沿用/覆盖/删除条目
- loadAiConfig 兜底:畸形条目过滤、>5 截断、trust 非法回落 confirm
- fixtures `full` 补 `mcpServers: []`

### 其它

- tools.test.ts l.57 附近 fixture 补 `mcpServers: []`;注册表计数断言不动(MCP 工具是动态的,不属于 AI_TOOLS)
- endpoints.test.ts 现有 payload 无 mcpServers → 走 `.default([])`,应仍通过(顺带验证缺省兼容)

## 10. 实施步骤

1. 新建 `workers/src/ai/mcp.ts`(McpClient + McpRegistry)
2. `types.ts`:McpServerConfig + AiConfig.mcpServers
3. `validate.ts`:aiMcpServerSchema + aiConfigSchema.mcpServers
4. `config.ts`:loadAiConfig 显式读 / maskConfig 空串守卫 / mergeMaskedKeys / DEFAULT
5. `agent.ts`:AgentDeps.mcp + 4 处原位替换
6. `router.ts`:条件注入 Registry
7. `web/src/routes/Admin/AiConfig.tsx`:MCP 服务器区块
8. 测试三个文件 + fixtures

### 验证

```
pnpm -C workers typecheck && pnpm test && pnpm -C web lint && pnpm build
手动冒烟: pnpm dev → 后台模型配置加 Tavily(key 拼 URL,trust=auto) → 聊天问"搜一下最新 xx" → mcp_ 工具执行返回搜索结果
```

## 11. 关键坑清单(实现时逐条对照)

1. `loadAiConfig` 剥未知字段 → mcpServers 必须显式读
2. `maskKey('')` 产生 `'sk-***'` → maskConfig 空串守卫
3. MCP POST 可能回 SSE 帧 → 双 content-type 解析,SSE 帧读完 `reader.cancel()`
4. 无状态服务器(Tavily)→ session 头可缺、initialize 可失败、通知回 202 当成功
5. 工具名 ≤64 + `mcp_` 前缀防冲突 + slug 清洗后空名回落 `'srv'`
6. 错误/日志不落 URL 与 key(URL 内嵌密钥)
7. 确认续跑是新 HTTP 请求 → resolveTools 必须先于 confirm 块执行
8. 子请求预算:10 分钟缓存让稳态回合零发现开销(Free 版 50 子请求/次)

## 12. 风险与开放问题

- **session 失效**:缓存命中的 client 带旧 sessionId,服务器重启后会 404;v1 不做自动重握手(单次调用报错喂回模型,下个 TTL 周期自愈),观察线上频率再决定
- Workers Free 版 50 子请求/次:单回合最坏 5 服务器发现(各 2-3 请求)+ 若干调用 + 厂商流,极端情况可能触顶;缓存缓解后稳态无虞,文档提示 Free 版用户少配几个服务器
- 各 MCP 服务器对 `2025-03-26` 协议版本兼容性不一:请求头固定版本,遇到不兼容服务器(发现失败)自动跳过,不阻塞内置工具
- MCP 工具的 inputSchema 直接透传给 OpenAI tools 参数,个别服务器的 schema 可能不合 OpenAI 规范(如缺 `type`);已兜底 `{type:'object'}`,如仍有厂商拒绝,后续在 wrapper 里做 schema 清洗
