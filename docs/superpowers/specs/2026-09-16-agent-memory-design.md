# AI 助手长期记忆(单文档,模型自维护)

日期:2026-09-16
状态:已与用户确认(方案 B 变体:单份记忆 + 长度上限),随写随施
前置:2026-09-15-ai-assistant-design.md、2026-09-16-unified-batch-and-policy-design.md

## 1. 形态

单份 markdown 文本记忆(`MEMORY.md` 式),大模型自己更新,跨会话持久。调研结论(mem0 管线/Letta 分级/CF Agent Memory)下,单用户个人站的量级选最简形态:全量注入 + 单工具替换。

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 存储 | `on_options` 新 key `s_ai_memory`(纯文本)——零迁移,先例 s_themes/s_ai |
| 注入 | 每轮 system prompt 末尾追加 `## 长期记忆` 段(非空时);模型始终可见 → 无需 memory_read |
| 更新 | 单工具 `memory_write(content)`:**整体替换**;模型看旧写新,自然完成增删改与压缩合并 |
| 长度上限 | **4000 字符**,超限拒绝并提示"请压缩合并"(错误喂回模型自愈) |
| 默认策略 | auto 直接执行("大模型自己更新");实现:AiTool 加可选 `defaultPolicy`,resolveExecPolicy 优先级 = toolPolicy 配置 > **工具 defaultPolicy** > danger 默认 |
| 语义 | danger='write'(配置页可随时改回"需确认") |

## 3. 架构(低耦合)

```
workers/src/ai/memory.ts   新:MEMORY_MAX_CHARS、loadMemory(db)、saveMemory(db, content)
workers/src/ai/tools.ts    +memory_write 条目(execute→saveMemory,超限返回业务错误)
workers/src/ai/agent.ts    system prompt 注入记忆;DEFAULT_SYSTEM_PROMPT 加记忆引导句
workers/src/ai/batch.ts    resolveExecPolicy 增加 defaultPolicy 层(Pick 类型扩展)
web AiConfig               TOOL_CANDIDATES 补 memory_write
```

依赖方向:tools→memory 单向;agent→memory 单向;不动 shared/前端协议。

## 4. 行为细节

- 空串合法(清空记忆)
- 注入格式:`\n\n## 长期记忆(跨会话持久;用 memory_write 整体更新,上限 4000 字符,保持精简)\n<content>`
- 回合内 systemPrompt 预计算:本轮写入的记忆下轮生效(模型知道刚写了什么,无需即时回读)
- memory_write 经 resolveExecPolicy=auto → 归入 batch_read 枚举(策略系统自然归类,名称外观接受)

## 5. 测试

- memory.test:读写回环、缺省空串
- tools.test:memory_write 落库、超限返回"压缩"错误、空串清空
- batch.test:resolveExecPolicy 尊重 defaultPolicy(memory_write→auto)
- agent.test:system 注入记忆内容;memory_write 默认无确认卡直接执行且 D1 更新;下轮 system 含新记忆

## 6. 升级路径(未实施)

记忆超量或需自动抽取时:存储层换/叠 CF Agent Memory(ingest 自动抽取 + recall 语义检索),工具签名不变,agent/前端零改动。
