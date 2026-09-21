# 操作日志:全量记录 + AI 可读(还原交给 AI 思考)

日期:2026-09-21
状态:已与用户确认(不做专门还原路径),随写随施
前置:2026-09-15-ai-assistant-design.md

## 1. 目标

每个数据操作(手动后台 / AI)留痕:动作、来源、前后快照、人话摘要。
还原不做专门机制——AI 经 `op_log_list` 读到快照,用现有工具
(update_link/create_link/delete_link/…)自行组合还原;人工也可让助手代劳。

## 2. 决策记录

| 决策点 | 结论 |
|---|---|
| 记录点 | handler 层唯一咽喉(手动/AI/batch_write 分解全部汇于此),一处覆盖全量 |
| 来源 | `OpMeta { source:'manual'|'ai', conversationId? }` 可选参数,缺省 manual |
| 快照 | 整行业务字段 JSON(**排除 icon_blob**——Buffer 体积大,且现有工具本就不还原图标) |
| 范围 | link/category 增删改、site.update、memory.update(batch 自动逐条入账) |
| 还原 | 无专门机制;`op_log_list` 工具(read)读最近日志(默认 10,上限 20,含快照) |
| 还原的还原 | AI 还原走的还是写 handler → 自动再入账 ✓(无需特殊设计) |
| 冲突 | 还原删除时 URL 撞唯一约束 → 业务错误喂回,AI 自会处理(改名/询问) |
| 管理页 | 暂不做(要查历史问助手即可;后续要可视化再加) |

## 3. 架构

```
migrations/0003_op_logs.sql + schema.ts   on_op_logs(action/source/conversation_id/
                                           target_id/summary/before_json/after_json/created_at)
handlers/oplog.ts   OpMeta、insertOpLog、snapshotLink/snapshotCategory(纯函数)
handlers/link.ts / category.ts / site.ts  写 handler 加可选 meta → 成功后记账
ai/memory.ts        saveMemory 记 before/after
ai/tools.ts         write 工具 execute 线程 meta(db, args, meta)→ handler;
                    新增 op_log_list(read;经工厂自动进 batch_read 枚举)
ai/agent.ts         execTool 传 {source:'ai', conversationId: cid};系统提示加一句
ai/batch.ts         runOps 线程 meta(batch 内每条子操作独立入账)
```

## 4. 测试

- oplog:六类 action 的快照正确性(update 双快照/delete 仅 before/create 仅 after)、
  source 区分、batch_write 逐条入账、memory/site 记账
- tools:op_log_list 注册为 read、返回最近 N 条含快照
- 既有套件回归(execute 签名加可选参不破坏旧调用)
