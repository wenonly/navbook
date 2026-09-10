-- OneNav Workers initial schema
-- 注意：本文件与 src/db/schema.ts 必须同 commit 修改；本 SQL 是 D1 结构的唯一事实源。
CREATE TABLE on_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  secret_key TEXT,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE on_categorys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  add_time INTEGER NOT NULL,
  up_time INTEGER,
  weight INTEGER NOT NULL DEFAULT 0,
  property INTEGER NOT NULL DEFAULT 0,
  description TEXT DEFAULT '',
  font_icon TEXT,
  fid INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE UNIQUE INDEX on_categorys_name_unique ON on_categorys(name);
CREATE INDEX on_categorys_fid_idx ON on_categorys(fid);

CREATE TABLE on_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fid INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  add_time INTEGER NOT NULL,
  up_time INTEGER,
  weight INTEGER NOT NULL DEFAULT 0,
  property INTEGER NOT NULL DEFAULT 0,
  click INTEGER NOT NULL DEFAULT 0,
  topping INTEGER NOT NULL DEFAULT 0,
  url_standby TEXT,
  font_icon TEXT,
  icon_source TEXT NOT NULL DEFAULT 'blob',
  icon_blob BLOB,
  icon_mime TEXT,
  check_status INTEGER NOT NULL DEFAULT 0,
  last_checked_time INTEGER
) STRICT;
CREATE UNIQUE INDEX on_links_url_unique ON on_links(url);
CREATE INDEX on_links_fid_idx ON on_links(fid);
CREATE INDEX on_links_weight_idx ON on_links(weight);

CREATE TABLE on_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  value TEXT,
  extend TEXT
) STRICT;
CREATE UNIQUE INDEX on_options_key_unique ON on_options(key);

CREATE TABLE on_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sid TEXT NOT NULL,
  add_time INTEGER NOT NULL,
  expire_time INTEGER NOT NULL,
  password TEXT,
  cid INTEGER NOT NULL,
  note TEXT
) STRICT;
CREATE UNIQUE INDEX on_shares_sid_unique ON on_shares(sid);

CREATE TABLE on_clicks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id INTEGER NOT NULL,
  ip TEXT,
  ua TEXT,
  referer TEXT,
  ts INTEGER NOT NULL
) STRICT;
CREATE INDEX on_clicks_link_id_idx ON on_clicks(link_id);
CREATE INDEX on_clicks_ts_idx ON on_clicks(ts);
