-- DO 后台回合:会话运行状态(跨崩溃可见;DO 内存标志的持久镜像)
-- 注意:本文件与 src/db/schema.ts 必须同 commit 修改;SQL 是 D1 结构的唯一事实源。
ALTER TABLE on_ai_conversations ADD COLUMN running INTEGER NOT NULL DEFAULT 0;
ALTER TABLE on_ai_conversations ADD COLUMN running_since INTEGER;
