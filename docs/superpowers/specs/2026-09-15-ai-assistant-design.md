# AI 助手(Assistant)设计

日期:2026-09-15
状态:已与用户逐段确认

## 1. 背景与目标

为 navbook 增加 AI 聊天助手:后台对接各大模型厂商 API key,管理端新增聊天页,主题页(登录态)提供气泡弹窗入口。助手可通过工具调用查询与修改平台数据(链接/分类),写操作需人工确认。所有入口仅管理员可用。

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 用户范围 | **仅管理员**(登录后可用);主题页气泡仅登录态渲染;游客在隐私/开放模式下均无入口 |
| 工具范围 | 查询 + 写操作一步到位,写操作须确认 |
| 厂商协议 | 预设厂商下拉(自动填 baseUrl/模型名)+ 自定义;底层统一 **OpenAI 兼容协议** |
| 编排层 | **自研轻量 agent 循环**(方案 A),零新 AI SDK 依赖,工具直接复用 handlers 纯函数 |
| 流式 | SSE(POST + `text/event-stream`),请求内流式,不用 WebSocket/Durable Objects |
| 会话存储 | D1 持久化(多端同步,消息即审计日志) |
| ReAct | 显式支持:中间推理文本保留渲染 + 原生思考流单独事件 + 折叠思考块 |

### 为什么不用 WebSocket + Durable Objects

DO + WebSocket Hibernation 解决的是**持久双向连接**(连接挂数小时、服务端随时推)。本功能是**请求内流式**:一次请求 = 一轮流式回复,流完即结束,与 OpenAI/Anthropic Chat API 同形态。付费版 Workers HTTP 请求无 wall-clock 时长上限,仅计 CPU 时间(等厂商 I/O 不计费),一轮对话 CPU 消耗为毫秒级。SSE 为正确答案,DO 属过度设计。

## 3. 总体架构

```
┌─ web /admin ──────────────┐   ┌─ themes/compass ────────┐
│ /admin/assistant 完整聊天页 │   │ 右下角气泡(仅登录态显示)  │
│ /admin/ai-config 模型配置页 │   │ 弹出精简聊天浮层          │
└──────────┬────────────────┘   └──────────┬──────────────┘
           │      共用 @navbook/shared      │
           │   (SSE 消费器 + 聊天状态机,纯TS)│
           ▼                               ▼
     POST /api/ai_chat (SSE)  ←──── authMiddleware(仅管理员)
           │
┌─ workers/src/ai/ ──────────────────────────────────┐
│ agent.ts  循环编排(读工具直接执行/写工具暂停等确认)   │
│ provider.ts  OpenAI兼容流式客户端+SSE解析            │
│ tools.ts   工具注册表 → 直接复用 handlers/ 纯函数    │
└──────────┬─────────────────────────────────────────┘
           ▼
     D1: on_options(s_ai 配置) + on_ai_conversations + on_ai_messages
```

- handler 域文件:`workers/src/handlers/ai.ts`(配置/会话 CRUD,纯函数惯例)
- 遵循现有惯例:Zod schema 入 `lib/validate.ts`(含 `token: z.string().optional()`)、路由注册入 `router.ts` 分区注释、`{code,msg,data}` 信封(ai_chat 流式除外)

## 4. 数据模型

迁移 SQL(`db/migrations/000N_ai.sql`)与 `db/schema.ts` **同 commit 修改**,表前缀沿用 `on_`。

### on_options 新 key `s_ai`(先例:`s_themes`)

```json
{
  "providers": [
    {"id": "p_xxx", "name": "DeepSeek", "preset": "deepseek",
     "baseUrl": "https://api.deepseek.com/v1",
     "apiKey": "sk-...", "model": "deepseek-chat",
     "toolCallFixes": {}}
  ],
  "activeProviderId": "p_xxx",
  "systemPrompt": "可选自定义人设"
}
```

- apiKey 明文存 D1(先例:SecretKey),靠端点鉴权保护;**读取时打码只返回尾 4 位**(`sk-***abcd`)
- `toolCallFixes`:per-preset 厂商差异修正字段预留(如个别厂商不支持并行工具调用)

### on_ai_conversations

`id, title, created_at, updated_at`。标题 = 首条用户消息截 20 字(不额外调模型)。

### on_ai_messages

`id, conversation_id, role(user/assistant/tool), content JSON, created_at`。

content 存结构化 JSON:文本、reasoning(思考流)、tool_calls、tool_result、pending 确认状态,均为消息的一部分——**对话历史天然构成操作审计日志**,且 Worker 无状态,流中断后凭消息表即可恢复界面。

## 5. API 端点

全部 authMiddleware(仅管理员)。

| 端点 | 说明 |
|---|---|
| `GET /api/ai_config` | 返回 s_ai(apiKey 打码)+ 预设厂商表(前端下拉用) |
| `POST /api/ai_config` | 整体保存;apiKey 传回打码占位值时保留原值不覆盖 |
| `GET /api/ai_conversations` | 会话列表(updated_at 倒序) |
| `DELETE /api/ai_conversations` | 按 id 删除,级联删消息 |
| `GET /api/ai_messages` | 按 conversation_id 拉历史 |
| `POST /api/ai_chat` | **SSE 主端点**,body: `cid, message, confirm?` |

## 6. SSE 事件协议

`POST /api/ai_chat` 返回 `text/event-stream`:

```
event: delta        data: {"text": "帮你在"}            ← 文本增量
event: reasoning    data: {"text": "..."}               ← 思考流增量(reasoning_content)
event: tool_call    data: {id, name, args, danger}      ← 模型发起工具调用
event: tool_result  data: {id, ok, summary, data}       ← 读工具执行结果
event: confirm_required data: {id, name, args, summary} ← 写工具待确认,本轮流结束
event: done         data: {messageIds, finishReason}    ← 回合结束
event: error        data: {code, msg}                   ← 厂商报错/超时等
: hb                                                     ← 心跳注释,静默期每 15s
```

鉴权失败在流开始前直接 401 JSON(不走流)。

### 写操作确认流转

1. 模型发起写工具 → 后端**不执行**,推 `confirm_required` 事件,流结束;`on_ai_messages` 记 `role=tool, status=pending` 消息
2. 前端渲染操作预览卡(summary 由后端生成,如"即将删除分类『xxx』及其下 N 条链接",前端不猜)
3. 用户「确认」→ 再次 `POST /api/ai_chat` 带 `confirm:{messageId}` → 后端执行工具、写结果消息、**恢复 agent 循环**
4. 用户「取消」→ 带 `confirm:{messageId, action:'reject'}` → 后端记拒绝,模型收到"用户拒绝了该操作"继续对话

### 防御性约束

- agent 循环上限 **8 步**(防模型无限调工具)
- 单条用户消息上限 8KB;会话消息数上限 500(超出提示新建会话);发给模型的上下文取最近 50 条消息
- 客户端断开(`c.req.raw.signal`)→ 停止循环;已完成的工具结果照常落库,半截文本标记截断
- 整轮超时上限 180s;厂商 fetch 用 `AbortSignal.timeout` 单独限制
- 心跳:静默期(工具执行/厂商往返间隙)每 15s 发 `: hb` 注释行,防边缘节点掐空闲连接(约百秒级)

## 7. 工具集

`workers/src/ai/tools.ts` 唯一注册点,加工具 = 加一个条目(模型 tools 数组、确认卡 UI 自动跟上):

```ts
interface AiTool {
  name: string
  description: string                    // 给模型看的中文说明
  parameters: JSONSchema                 // OpenAI function calling 格式
  danger: 'read' | 'write'
  summarize(args, result): string        // 确认卡/结果卡中文文案(后端生成)
  execute(db, args)                      // 直接调 handlers/ 现有纯函数
}
```

第一版 12 个:

| 工具 | danger | 复用 |
|---|---|---|
| `search_links`(关键词/分类/属性筛选) | read | link_list(keyword/property 参数) |
| `list_categories` | read | category_list |
| `get_link` | read | get_a_link |
| `get_click_stats`(链接/分类点击排行) | read | 直查 on_clicks(无现成 handler) |
| `get_site_config` | read | site_config |
| `create_link`(标题/URL/分类/私密标记) | **write** | add_link |
| `update_link` | **write** | edit_link |
| `delete_link` | **write** | del_link |
| `create_category`(名称/私密/父分类) | **write** | add_category |
| `update_category` | **write** | edit_category |
| `delete_category`(summary 必须写明波及链接数) | **write** | del_category |
| `batch_write`(多写操作一次提交、一张确认卡,部分失败逐项报告) | **write** | 聚合上表 6 个写工具(顺序执行,上限 20 项) |

**刻意排除(第一版不做)**:站点全局设置写操作(开关隐私模式、切换主题、轮换 SecretKey、导入导出)——影响整站鉴权与安全面,待框架跑稳后再评估白名单。

细节:
- `execute` 返回值原样透传模型(`{code,msg,data}`),模型可见业务错误(如"分类不存在")自行纠正——agent 自愈关键
- 工具以管理员身份运行,天然可见全部数据(含私密);`summarize` 给人看的卡片只呈现操作要点

## 8. ReAct 模式

agent 循环本身即 ReAct(Reason→Act→Observe 交替),设计上显式支持:

- **中间推理保留**:多步循环中每轮 assistant 的文本(Thought)完整落库并渲染,不只显示最终答案——用户能看到"我先搜了 X,发现…,所以再…"
- **原生思考流**:provider.ts 同时解析 `delta.content` 与 `delta.reasoning_content`(DeepSeek/Qwen 等思考模型的 OpenAI 兼容扩展),分别以 `delta`/`reasoning` 事件下发;按有无 reasoning 增量自动生效,无需配置
- **UI 折叠思考块**:管理端与主题气泡均以可折叠"思考过程"块渲染 reasoning,默认收起;中间 Thought 文本正常内联渲染
- 消息 content JSON 中 reasoning 独立字段存储,历史回放与实时流共用同一渲染逻辑

## 9. 前端双入口

### shared(纯 TS,UI 无关,两端复用)

```
shared/src/chat/
  sse.ts        fetch+ReadableStream 的 SSE 行解析(跨chunk边界/心跳忽略/abort)
  machine.ts    聊天状态机:发消息→流事件归约→确认/取消→恢复,消息列表状态
```

管理端与主题端只写 UI 壳,逻辑一份。`createApiClient()` 照旧负责普通端点,SSE 走 `sse.ts`(POST + 手动解析,同源 cookie 自动带)。

### 管理端(NAV_SECTIONS 新增「AI」分组,两个页面)

| 路由 | 内容 |
|---|---|
| `/admin/ai-config` | 厂商列表(预设下拉自动填 baseUrl/模型名,可改)+ 新增自定义 + 设为当前(单选) + 系统提示词;key 输入框密码态、回显打码 |

内置预设厂商:DeepSeek、通义千问、Kimi、智谱、豆包、OpenAI、Anthropic(兼容端点)、Gemini(兼容端点)、自定义。
| `/admin/assistant` | 左侧会话列表(可折叠/删除)+ 右侧消息流 + 输入框;shadcn 风格 |

消息流特殊渲染:读工具卡(名称+摘要,可展开原始 JSON)、写操作确认卡(summary + 确认执行/取消,按完续流)、思考折叠块、错误条、停止生成按钮(abort)、重试按钮。

### 主题页气泡(先做 compass,minima 后续跟进)

- 仅 `useSession()` 为登录态时渲染右下角气泡按钮——满足权限隔离:所有入口都要求管理员登录,与 `site_private` 无关(两种模式下登录管理员体验一致,游客均无入口)
- 点击展开约 380×560 聊天浮层,compass 自有样式体系(不引 shadcn,主题包体积敏感)
- 单会话模式:打开即续接最近会话,不放会话列表
- 确认卡在浮层同样可用(同一管理员身份,能力与管理端一致)

## 10. 权限模型

| 场景 | 可见性 | 能力 |
|---|---|---|
| 管理端任意页 | 登录守卫(Layout 已有) | 全部 |
| 主题页(隐私/开放模式均同) | 仅登录管理员见气泡 | 全部(同管理端) |
| 游客(任意模式) | 无入口 | 无 |

所有 `/api/ai_*` 端点 authMiddleware;工具以管理员身份执行。单用户平台下无需角色框架。

## 11. 错误处理

| 层 | 情况 | 处理 |
|---|---|---|
| 鉴权 | cookie 失效 | 流开始前 401 JSON,前端跳登录 |
| 配置 | 未配 provider/未选当前 | 明确文案引导去 `/admin/ai-config` |
| 厂商 | 401/402(key 失效/欠费)、429 限流 | `error` 事件带分类文案;已生成文本保留 |
| 厂商 | 流中断/网络错误 | `error` 事件;前端「重试」重发本轮 |
| 工具 | 业务错误(code≠0) | 不算错误——作为 tool result 喂回模型自愈 |
| 工具 | 执行异常(throw) | catch 转错误 tool result 喂回模型,循环不崩 |
| 客户端 | 停止/断线刷新 | abort 停循环;D1 消息为唯一真相源,重拉 `ai_messages` 恢复界面,pending 确认卡仍在 |

## 12. 测试策略

vitest + `@cloudflare/vitest-pool-workers` + 真实 D1(现有惯例,`resetTables()` beforeEach):

- **provider.ts**:伪厂商 SSE fixture——纯文本流 / 带 tool_calls / **arguments 分片到达** / reasoning_content / 流中途报错,断言解析
- **tools.ts**:每工具直测 `execute`(断言 D1 行级变化)+ summarize 文案快照
- **agent.ts**(重点):mock provider + 真实 D1 全循环——纯对话、读工具链、写工具「confirm_required→确认→续流」、拒绝路径、8 步上限熔断、业务错误自愈、reasoning 事件透传
- **配置端点**:apiKey 打码返回、占位值不覆盖
- **machine.ts**(shared):纯函数状态机,根 workspace vitest 直测,零新配置

## 13. 实施分期(spec 内实施顺序,非砍功能)

1. **配置链路**:`s_ai` + 迁移 + 配置端点 + `/admin/ai-config` 页
2. **聊天核心**:会话表 + provider.ts + agent.ts(只读工具)+ SSE 端点 + 管理端聊天页 + shared sse/machine
3. **写工具 + 确认机制**:confirm 参数 + 确认卡 UI
4. **compass 气泡**:浮层 + 登录态渲染

## 14. 风险与开放问题

- Workers 免费版 10ms CPU 对长对话可能紧张,付费版无虞(30s 默认可调 5min)
- 各厂商 function calling 细节差异(并行工具调用支持等)——`toolCallFixes` 字段预留
- tool_calls 增量 JSON 拼装(arguments 分片)是已知繁琐点,fixture 重点覆盖
