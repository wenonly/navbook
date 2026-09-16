# agent 网页抓取能力 + Claude/Cursor 式 Loading/串行 UX

日期:2026-09-16
状态:已实施(commit c83f14b;§6 测试全部落地,workers 234 + shared 13 测试全绿)
前置:2026-09-15-ai-assistant-design.md、2026-09-16-mcp-integration-design.md

## 1. 目标

1. agent 具备自主访问链接获取内容的能力(内置 `fetch_url` 工具)
2. 前端呈现工具 loading 过程(spinner + 计时 + 状态条),全程阻塞新消息直到回合结束——与 Claude/Cursor 一致的串行体验
3. pending 确认卡阻塞新消息(不处理不能继续)

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 实现方式 | 内置 `fetch_url` 工具(Workers 原生 fetch + HTMLRewriter),零外部依赖;SPA 空壳页由已配的 MCP 网页读取兜底 |
| 工具级别 | danger='read',自动执行不确认 |
| 提取 | title / meta description / og:title / og:description / 正文可见文本(剥 script/style/head/nav/footer/aside 等) |
| 限额 | 请求超时 15s;驱动流最多读 512KB 即 cancel;最终正文截 16K 字符(与 MCP 工具一致) |
| content-type | html→HTMLRewriter;text/plain、json、xml、markdown→直读;二进制→只报类型不读体 |
| HTTP 非 2xx | 不算错误:作为正常数据喂回(模型能据此告知"链接 404 了") |
| loading 数据源 | 纯前端:streaming 状态 + 工具卡 startedAt 时间戳,服务端零改动(心跳已防空闲断连) |
| pending 阻塞 | machine 层守卫 + `blockedReason()` 暴露给 UI(可测纯函数) |
| 状态条文案 | shared 导出纯函数 `activityLabel(snapshot)`,web/compass 共用一份逻辑 |

## 3. 架构(低耦合边界)

```
workers/src/ai/fetcher.ts   新:纯函数 fetchAndExtract(url, fetchFn?) → FetchResult
                             (抓取+HTMLRewriter 提取+限额;不知道 tool/agent 存在)
workers/src/ai/tools.ts     fetch_url 条目 = 薄 wrapper(execute → fetchAndExtract)
shared/src/chat/machine.ts  UiItem.tool 加 startedAt;send() 加 pending 守卫;
                             新增 blockedReason(snapshot) / activityLabel(snapshot) 纯函数
web ChatMessages/Assistant  spinner+计时+状态条+composer 阻塞态(仅渲染,逻辑全在 shared)
compass AssistantBubble     同款轻量实现(既有"UI 壳两端各自实现"惯例)
```

依赖方向不变:tools→fetcher 单向;UI 只读 snapshot 派生,不含业务逻辑。

## 4. fetchAndExtract 契约

```ts
interface FetchResult {
  status: number;        // HTTP 状态码(网络错误时 0)
  finalUrl: string;      // 重定向后的最终地址(res.url)
  contentType: string;
  title: string;         // <title> 优先,og:title 兜底
  description: string;   // meta description 优先,og:description 兜底
  text: string;          // 正文(空白归一,截 16K;二进制为空)
  truncated: boolean;    // 512KB 驱动流截断标记
  note?: string;         // 二进制等说明
}
```

- UA:`NavBookAIBot/1.0`;`redirect:'follow'`;`AbortSignal.timeout(15_000)`
- 网络错/超时 → 调用方包成 `{code:-2000, msg:'抓取超时' | '网络错误,无法访问'}`
- HTMLRewriter 驱动:transform 后自读输出流计字节,>512KB cancel;skip 栈(`el.onEndTag` 配对)排除 script/style/noscript/svg/template/head/nav/footer/aside

## 5. 前端行为

- 工具卡 `running`:Loader2 旋转图标 + `执行中 · Ns`(组件本地 1s interval,用 machine 打的 startedAt;历史回放无 running 态不需要)
- 状态条(streaming 时消息流底部):`正在思考…` → `正在调用 <tool>…` → `正在生成回复…`(activityLabel 派生,pulse 动画)
- composer:streaming 或 pending 时发送禁用,placeholder 显示 blockedReason 文案
- compass 气泡:同语义,样式用自有 token

## 6. 测试

- `tests/ai/fetcher.test.ts`(新):fetch 注入 HTML fixture(标题/meta/正文提取、script 剥离、512KB 截断、16K 截断、404、二进制、超时、重定向 finalUrl)
- `tests/ai/tools.test.ts`:fetch_url 注册/summarize/execute 直通
- `shared machine.test.ts`:pending 阻塞 send(transport 不被调)、blockedReason 文案、activityLabel 三态、startedAt 打点

## 7. 已知边界

- SPA 纯客户端渲染页面拿到空壳(title 可能有,正文近空)→ 模型会如实告知,MCP 深度抓取兜底
- Workers 不执行 JS、不入私网;端点本身仅管理员可用
- DEFAULT_SYSTEM_PROMPT 补一句可用 fetch_url 抓任意网页
