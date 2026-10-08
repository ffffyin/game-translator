import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync } from 'fs'
import { applyMigrations, CURRENT_SCHEMA_VERSION } from '../../src/main/db/schema'
import { SettingsService } from '../../src/main/services/settings'
import { Db } from '../../src/main/services/db-wrapper'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

function newDb(file: string): Db {
  return new Db(file)
}

const EXPECTED_TABLES = [
  'settings',
  'model_configs',
  'term_libraries',
  'terms',
  'phrases',
  'hotkeys',
  'usage_logs',
  'app_meta'
]

function listTables(db: { prepare: (s: string) => { all: () => Array<{ name: string }> } }) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name)
}

describe('数据库迁移', () => {
  let db: ReturnType<typeof newDb>
  beforeAll(() => {
    db = newDb(':memory:')
    applyMigrations(db)
  })
  afterAll(() => db.close())

  it('迁移后 user_version 为当前版本', () => {
    expect(db.prepare('PRAGMA user_version').get().user_version).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('创建全部 8 张表', () => {
    const tables = listTables(db)
    for (const t of EXPECTED_TABLES) expect(tables).toContain(t)
  })

  it('重复迁移保持幂等', () => {
    expect(() => applyMigrations(db)).not.toThrow()
    const tables = listTables(db)
    expect(tables.length).toBeGreaterThanOrEqual(EXPECTED_TABLES.length)
  })
})

describe('SettingsService', () => {
  let db: ReturnType<typeof newDb>
  let settings: SettingsService

  beforeAll(() => {
    db = newDb(':memory:')
    applyMigrations(db)
    settings = new SettingsService(db)
  })
  afterAll(() => db.close())

  it('空库返回默认设置', () => {
    expect(settings.getAll()).toEqual(DEFAULT_SETTINGS)
  })

  it('set 后立即生效且可读取', () => {
    settings.set('themeMode', 'light')
    expect(settings.get('themeMode')).toBe('light')
    settings.set('accentColor', '#3CC7AB')
    expect(settings.get('accentColor')).toBe('#3CC7AB')
  })

  it('未知设置键抛错', () => {
    expect(() => settings.set('notExist', 'x')).toThrow()
  })

  it('set 同名键为更新而非新增', () => {
    settings.set('themeMode', 'dark')
    const rows = db.prepare("SELECT * FROM settings WHERE key='themeMode'").all()
    expect(rows.length).toBe(1)
  })
})

describe('设置持久化（关闭重开不丢失）', () => {
  const dir = join(tmpdir(), 'gt-db-persist-test')
  beforeAll(() => mkdirSync(dir, { recursive: true }))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('写入 → 关闭 → 重新打开后值仍在', () => {
    const db1 = newDb(join(dir, 'translator.db'))
    applyMigrations(db1)
    new SettingsService(db1).set('themeMode', 'light')
    db1.close()

    const db2 = newDb(join(dir, 'translator.db'))
    applyMigrations(db2)
    expect(new SettingsService(db2).get('themeMode')).toBe('light')
    db2.close()
  })
})
