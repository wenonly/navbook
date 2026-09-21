-- 操作日志:全量留痕(手动/AI 同源),快照供 AI 还原
-- 注意:本文件与 src/db/schema.ts 必须同 commit 修改;SQL 是 D1 结构的唯一事实源。
CREATE TABLE on_op_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                    -- link.create|link.update|link.delete|category.*|site.update|memory.update
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | ai
  conversation_id INTEGER,                 -- ai 来源时的会话 id
  target_id INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  before_json TEXT,                        -- 操作前整行业务字段(排除 icon_blob)
  after_json TEXT,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX on_op_logs_id_idx ON on_op_logs(id);
