-- AI 助手会话/消息表
-- 注意:本文件与 src/db/schema.ts 必须同 commit 修改;SQL 是 D1 结构的唯一事实源。
CREATE TABLE on_ai_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX on_ai_conversations_updated_at_idx ON on_ai_conversations(updated_at);

CREATE TABLE on_ai_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL,
  role TEXT NOT NULL,          -- 'user' | 'assistant' | 'tool'
  content TEXT NOT NULL,       -- JSON,形状见 ai/types.ts ChatMsgContent
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX on_ai_messages_conversation_id_idx ON on_ai_messages(conversation_id);
