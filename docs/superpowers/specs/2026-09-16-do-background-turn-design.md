# DO 后台回合:断连续跑 + 重挂续流(架构 v2)

日期:2026-09-16
状态:已与用户确认(含双写推演完善),随写随施
前置:2026-09-15-ai-assistant-design.md 及后续全部 AI spec

## 1. 目标

聊天回合在客户端断连/关页后继续运行;刷新/重开页面无缝续流;多会话物理隔离不冲突;崩溃自愈;空闲零计费。

## 2. 选型与价格结论

- **Durable Object**(每会话一实例,id=`conv-<cid>`):单写者物理保证、回合在实例内运行与客户端连接解耦、alarm 原语兜底、真流式重挂。
- 价格:Free 计划 DO 额度 13,000 GB-s/天 + 100k 请求/天;本站用量(20 回合/天×60s×128MB ≈ 150 GB-s/天)**免费覆盖,余量 86 倍**。SQLite-backed(Free 仅支持此形态,亦即所需)。
- 弃选:waitUntil 方案(轮询重挂、标志位约定式并发防护)作为对照保留在讨论记录;DO 与其价格无差异而架构等级更高。

## 3. 核心不变式(双写的正确化)

> **落库为源,SSE 为投影**:emit(ev) = 先落库(成功)→ 再广播(尽力)。

- 任何时刻 SSE 中的内容均已持久化 → 重挂一致性有基础
- 落库失败:小重试,最终失败才终止回合;**error 也是消息,落库**(修复现状 error 只 emit 不落库)
- 广播失败(观众退场)静默,回合继续

职责分工:**agent = 真相(全部落库行为),DO = 传输(缓冲+广播),D1 = 唯一持久真相源**。DO 内存只放易失状态,丢实例不丢数据。

## 4. 协议扩展(shared/workers 镜像同步)

```
AssistantMsgContent + live?: boolean(渐进落库行标记) + truncated?: boolean(中断标记)
ChatMsgContent + ErrorMsgContent { text };ChatMessageDto.role + 'error'
UiItem + { kind:'error'; text }
done 事件 + stopped?: boolean
hello 事件(仅 /events):{ type:'hello'; running:boolean }
resync 事件:{ type:'resync' }(缓冲超限时前端退化为全量重读 DB)
```

## 5. 数据与端点

- **迁移 0002**:`on_ai_conversations` + `running INTEGER NOT NULL DEFAULT 0`、`running_since INTEGER`
- 三态 running:DO 内存(拒同会话并发 /turn)/ DB 列(跨崩溃可见,会话列表直读)/ alarm(兜底)
- 端点(router 层鉴权+Zod;DO 不鉴权,仅经绑定可达):
  - `POST /api/ai_chat` → 预建会话(cid=0 时)→ DO `/turn`(SSE 透传)。**agent 不再自建会话**,conversationId 必传
  - `GET /api/ai_events?cid=` → DO `/events`(重挂 SSE:hello → 回放本回合全量缓冲 → 实时转发)
  - `POST /api/ai_stop {cid}` → DO `/stop` → abort 本回合控制器(幂等)
- 会话列表输出 + running 字段

## 6. AgentTurnDO(新,workers/src/do/AgentTurnDO.ts)

```
/turn   running? 409;置 running(内存+DB+since)、events=[]、abortController、
        alarm.schedule(now+190s) → runAgentTurn(deps, cfg, {emit: buffer→broadcast})
        finally: running=false、DB running=0、alarm cancel、**关闭全部订阅流**
/events 注册订阅;running? 回放缓冲+实时;否则 hello{running:false} 即关
/stop   abortController.abort()(provider 流中断→agent 落库 truncated→done{stopped})
/alarm !running return;DB running 卡死(>190s)→ 清 live/标 truncated/running=0
缓冲    cap 3000 事件,连续 delta 合并最旧;超限发 resync
计费健康 done 即关全部订阅(空闲页面零连接,DO 休眠零计费);仅 running 期间 active
```

## 7. agent.ts 改动(渐进落库与中断自愈)

- **assistant 行提前插入**:每个 provider step 流开始即 insert(live:true,空文本),流中**每 2s 节流 update** 已累积 text/reasoning,step 末 final update(填 toolCalls)
- 回合正常结束:done 前把本回合全部 live 行清除 live 标记(messageIds 已收集)
- **中断路径**(provider catch):半截 assistant 标 truncated 落库 → fail() 内**error 行落库** → emit error → return
- AbortError(停止)与普通错误分流:停止 → done{stopped:true};错误 → error 事件
- conversation 自建分支删除(cid 由 router 预建传入);conversation 事件照发
- emit 顺序天然满足"先库后播"(agent 全责落库)

## 8. 前端(machine + UI)

- transport + `attach(cid, signal)`:GET /api/ai_events SSE → 复用归约器(重放=直播,零适配)
- `open(cid)`:读历史(running 时**跳过 live 行**)→ running? 自动 attach → hello{running:false} 则止
- 重挂流从 delta 开始自然开新气泡;done 结束
- UiItem error 渲染(web+compass 红条);会话列表 running 徽标
- 停止按钮改 POST /ai_stop(断连接不再有停止语义)

## 9. 测试

- DO 集成(vitest-pool-workers 真实 DO):中途断连重挂续流 / stop 半截落库 / alarm 崩溃自愈 / 同会话并发 /turn 被拒 / 空闲后 events 即关
- agent:渐进落库节流、truncated/error 行落库、live 清除、done{stopped}
- machine:重放与直播同流深等、hello/resync 分支、跳过 live 行
- 既有套件回归(消息序列合法性等不变式不受影响)

## 10. 边界与已接受限制

- 部署窗口杀死进行中回合 → alarm 190s 后自愈(个人站可接受)
- 重挂在回合结束后到达 → hello{running:false},前端以 DB 为准
- /events 订阅仅存在于 running 期间(计费健康不变式)
- 升级路径:WebSocket hibernation(真·空闲长连)留待需要时
