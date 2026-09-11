// 注意：本文件与 src/db/migrations/0000_init.sql 必须同 commit 修改。
// SQL 是 D1 结构的唯一事实源；本文件的 {length} 标注仅作文档，SQLite/D1 不强制长度。
// 唯一运行时约束来自 STRICT 表 + handlers 层的 Zod 校验。

import { sqliteTable, integer, text, blob, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('on_users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  // 保留列（当前无人写入）：实际 SecretKey 存 on_options（对齐 PHP 原版），见 middleware/auth.ts
  secretKey: text('secret_key'),
  createdAt: integer('created_at').notNull(),
});

export const categorys = sqliteTable('on_categorys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name', { length: 64 }).notNull(),
  addTime: integer('add_time').notNull(),
  upTime: integer('up_time'),
  weight: integer('weight').notNull().default(0),
  property: integer('property').notNull().default(0),
  description: text('description', { length: 512 }).default(''),
  fontIcon: text('font_icon', { length: 64 }),
  fid: integer('fid').notNull().default(0),
}, (t) => [
  uniqueIndex('on_categorys_name_unique').on(t.name),
  index('on_categorys_fid_idx').on(t.fid),
]);

export const links = sqliteTable('on_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fid: integer('fid').notNull(),
  title: text('title', { length: 512 }).notNull(),
  url: text('url', { length: 2048 }).notNull(),
  description: text('description', { length: 512 }),
  addTime: integer('add_time').notNull(),
  upTime: integer('up_time'),
  weight: integer('weight').notNull().default(0),
  property: integer('property').notNull().default(0),
  click: integer('click').notNull().default(0),
  topping: integer('topping').notNull().default(0),
  urlStandby: text('url_standby', { length: 2048 }),
  fontIcon: text('font_icon', { length: 512 }),
  // icon_blob IS NULL 即无图标；icon_source 仅在 icon_blob 非空时有意义（Phase 3 图标上传启用）
  iconSource: text('icon_source', { length: 16 }).notNull().default('blob'),
  iconBlob: blob('icon_blob', { mode: 'buffer' }),
  iconMime: text('icon_mime', { length: 32 }),
  checkStatus: integer('check_status').notNull().default(0),
  lastCheckedTime: integer('last_checked_time'),
}, (t) => [
  uniqueIndex('on_links_url_unique').on(t.url),
  index('on_links_fid_idx').on(t.fid),
  index('on_links_weight_idx').on(t.weight),
]);

export const options = sqliteTable('on_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key', { length: 64 }).notNull(),
  value: text('value'),
  extend: text('extend'),
}, (t) => [
  uniqueIndex('on_options_key_unique').on(t.key),
]);

export const shares = sqliteTable('on_shares', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sid: text('sid', { length: 8 }).notNull(),
  addTime: integer('add_time').notNull(),
  expireTime: integer('expire_time').notNull(),
  password: text('password', { length: 16 }),
  cid: integer('cid').notNull(),
  note: text('note', { length: 2048 }),
}, (t) => [
  uniqueIndex('on_shares_sid_unique').on(t.sid),
]);

export const clicks = sqliteTable('on_clicks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  linkId: integer('link_id').notNull(),
  ip: text('ip', { length: 64 }),
  ua: text('ua', { length: 256 }),
  referer: text('referer', { length: 256 }),
  ts: integer('ts').notNull(),
}, (t) => [
  index('on_clicks_link_id_idx').on(t.linkId),
  index('on_clicks_ts_idx').on(t.ts),
]);
