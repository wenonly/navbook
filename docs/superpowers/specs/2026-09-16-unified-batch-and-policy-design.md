# 统一批量工具协议 + 执行策略(确认口子)

日期:2026-09-16
状态:已与用户确认(fetch_url 默认 auto 可配置),随写随施
前置:2026-09-15-ai-assistant-design.md、2026-09-16-mcp-integration-design.md

## 1. 目标

1. 批量协议统一:`batch_read`(auto 策略工具,并发)与 `batch_write`(confirm 策略工具,聚合确认卡)同形状 `{operations:[{action,args}]}`,**action 枚举动态生成**(内置 + MCP 全部可用工具,未来新工具零代码自动可嵌)
2. 确认拦截口子:`s_ai.toolPolicy` 按工具名覆盖执行策略(如把 fetch_url 设为"需确认");MCP 工具默认跟随服务器 trust,也可按名覆盖
3. agent 同回合多个 auto 工具调用并行执行(confirm 类保持串行确认流)

## 2. 核心抽象

```ts
type ToolPolicy = Record<string, 'auto' | 'confirm'>;
// 唯一决策点:所有确认行为收口到这一个纯函数
resolveExecPolicy(tool, policy) = policy[tool.name] ?? (tool.danger === 'write' ? 'confirm' : 'auto')
```

- MCP wrapper 的 danger 已按 trust 映射(trust=auto→read);toolPolicy 再覆盖一层 → 三级优先:配置 > MCP trust > 内置默认
- agent 执行分支从 `tool.danger === 'write'` 改为 `resolveExecPolicy(...) === 'confirm'`
- pending 恢复流(approve)不改:确认卡创建时已是 confirm,approve 直接执行

## 3. 架构(低耦合)

```
tools.ts
  AI_TOOLS           静态注册表(移除 batch_write 静态条目)
  resolveExecPolicy  纯函数(策略决策唯一出口)
  buildBatchTools(available, policy) → [batch_read, batch_write]
                     工厂:闭包持有当前工具集+策略 → 动态 action 枚举、
                     嵌套/策略不符逐项报错、batch_read 并发(池 ≤4、≤10 项)、
                     batch_write 顺序(≤20 项,现状语义)
agent.ts
  base = 内置 + mcpTools;batch = buildBatchTools(base, cfg.toolPolicy)
  tools 数组 = base + batch;resolveTool 查 base+batch
  同回合 tool_call 事件先全部发出,auto 类 Promise.all 并发执行,confirm 类逐个 pending
types/config/validate
  AiConfig.toolPolicy(默认 {});loadAiConfig 显式读+过滤;schema z.record(z.enum(['auto','confirm']))
web AiConfig
  「工具确认策略」区:每行 工具名+Select(跟随默认/直接执行/需确认),仅存显式设置
```

## 4. 决策记录

| 决策点 | 结论 |
|---|---|
| fetch_url 默认策略 | auto(现状),配置可改 confirm |
| batch 上限 | read ≤10 项并发 4;write ≤20 项顺序(现状) |
| batch 工具形态 | 工厂动态生成(静态注册表装不下动态枚举) |
| 策略不符项 | 逐项错误喂回模型自愈,不炸批 |
| 嵌套 | batch 不可进 batch(enum 排除自身) |
| 部分失败 | 顶层 code=-1 + 逐项明细(与现状 batch_write 一致) |
| DEFAULT_SYSTEM_PROMPT | 更新:读批量用 batch_read,写批量用 batch_write |

## 5. 测试

- tools.test:六个单写工具注册(静态断言改造);工厂生成的 batch_read(并发计数/上限/非法 action/枚举同步)/batch_write(既有语义回归)
- agent.test:toolPolicy 把 fetch_url 覆盖为 confirm → 出确认卡;batch_read 集成(两项并发执行结果喂回);同回合双 auto 调用并行且都落库
- config.test:toolPolicy 读写、非法值过滤

## 6. 已知边界

- batch_read 并发打外部(fetch/MCP)受子请求预算约束:≤10 项 × 并发 4 可控
- toolPolicy 覆盖写工具为 auto = 跳过确认执行,配置页文案明示风险
- 模型仍可能单发调用(prompt 引导优先 batch,不强制)
