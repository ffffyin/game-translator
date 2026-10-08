// 数据库迁移：PRAGMA user_version 递增
// 每个迁移必须幂等（IF NOT EXISTS），并在一个事务内执行
import type { Db } from '../services/db-wrapper'

export const CURRENT_SCHEMA_VERSION = 1

export const MIGRATIONS: Record<number, string[]> = {
  1: [
    `CREATE TABLE IF NOT EXISTS settings (
       key TEXT PRIMARY KEY,
       value TEXT,
       updated_at TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS model_configs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       provider TEXT,
       base_url TEXT,
       api_key_enc TEXT,
       text_model TEXT,
       vision_enabled INTEGER DEFAULT 0,
       vision_model TEXT,
       params_json TEXT,
       is_default INTEGER DEFAULT 0,
       created_at TEXT,
       updated_at TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS term_libraries (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       game TEXT,
       name TEXT,
       version TEXT DEFAULT '0',
       source_url TEXT,
       is_builtin INTEGER DEFAULT 0,
       updated_at TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS terms (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       lib_id INTEGER,
       source_text TEXT,
       target_text TEXT,
       tag TEXT,
       is_custom INTEGER DEFAULT 0,
       updated_at TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS phrases (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       slot INTEGER,
       content TEXT,
       accelerator TEXT,
       sort_order INTEGER DEFAULT 0,
       enabled INTEGER DEFAULT 1,
       is_custom INTEGER DEFAULT 1,
       updated_at TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS hotkeys (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       action_code TEXT UNIQUE,
       accelerators TEXT,
       enabled INTEGER DEFAULT 1,
       updated_at TEXT
     )`,
    `CREATE TABLE IF NOT EXISTS usage_logs (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       ts TEXT,
       config_id INTEGER,
       kind TEXT,
       engine TEXT,
       chars INTEGER,
       tokens_in INTEGER,
       tokens_out INTEGER
     )`,
    `CREATE TABLE IF NOT EXISTS app_meta (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       schema_version INTEGER,
       app_version TEXT
     )`
  ]
}

// 在给定连接上执行增量迁移（同时供主进程与单元测试使用）
export function applyMigrations(db: Db): void {
  const row = db.pragmaGet<{ user_version: number }>('user_version')
  const version = row.user_version
  if (version >= CURRENT_SCHEMA_VERSION) return

  for (let v = version + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const statements = MIGRATIONS[v]
    if (!statements) continue
    const tx = db.transaction(() => {
      for (const sql of statements) db.exec(sql)
      db.pragma(`user_version = ${v}`)
    })
    tx()
  }
}
