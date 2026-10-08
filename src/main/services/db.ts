import { join } from 'path'
import { applyMigrations } from '../db/schema'
import { Db } from './db-wrapper'

export type { Db }

let dbInstance: Db | null = null

export function openDb(root: string): Db {
  const dbPath = join(root, 'translator.db')
  const db = new Db(dbPath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    applyMigrations(db)
  } catch (e) {
    // 半成品句柄必须关掉，否则文件被占用，还原流程无法覆盖
    try {
      db.close()
    } catch {
      // ignore
    }
    throw e
  }
  dbInstance = db
  return db
}

// 损坏/非法文件时不抛出，返回 null，交由启动还原流程处理
export function safeOpenDb(root: string): Db | null {
  try {
    return openDb(root)
  } catch {
    dbInstance = null
    return null
  }
}

export function getDb(): Db {
  if (!dbInstance) throw new Error('Database not opened')
  return dbInstance
}

export function migrate(db: Db): void {
  applyMigrations(db)
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
