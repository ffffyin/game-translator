import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { Db } from '../../src/main/services/db-wrapper'
import {
  listBackups,
  createBackup,
  dailyBackupIfNeeded,
  pruneDailyBackups,
  restoreBackup,
  integrityOk
} from '../../src/main/services/backup'

let root: string
let db: Db

beforeAll(() => {
  root = join(tmpdir(), `gt-backup-${Date.now()}`)
  mkdirSync(join(root, 'backups'), { recursive: true })
  db = new Db(join(root, 'translator.db'))
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE t (v TEXT)')
  db.prepare('INSERT INTO t VALUES (?)').run('hello')
})

afterAll(() => {
  try {
    db.close()
  } catch {
    // 还原测试中已关闭
  }
  rmSync(root, { recursive: true, force: true })
})

describe('备份服务', () => {
  it('创建备份：文件存在且与主库内容一致', () => {
    const p = createBackup(root, db, 'manual-1.db')
    expect(existsSync(p)).toBe(true)
    expect(readFileSync(p)).toEqual(readFileSync(join(root, 'translator.db')))
    expect(listBackups(root).some((b) => b.name === 'manual-1.db')).toBe(true)
  })

  it('每日备份：首次创建、再次调用跳过', () => {
    const day = new Date().toISOString().slice(0, 10)
    const p = dailyBackupIfNeeded(root, db)
    expect(p).toContain(day)
    expect(dailyBackupIfNeeded(root, db)).toBeNull()
  })

  it('保留策略：只留最近 7 份每日备份', () => {
    for (let m = 1; m <= 10; m++) {
      const name = `translator-2025-${String(m).padStart(2, '0')}-01.db`
      createBackup(root, db, name)
    }
    pruneDailyBackups(root, 7)
    const daily = listBackups(root).filter((b) => /^translator-\d{4}-\d{2}-\d{2}\.db$/.test(b.name))
    expect(daily.length).toBe(7)
    // 手动备份不受保留策略影响
    expect(listBackups(root).some((b) => b.name === 'manual-1.db')).toBe(true)
  })

  it('还原：备份覆盖主库，非法备份名抛错', () => {
    expect(() => restoreBackup(root, 'nope.db')).toThrow()
    db.close()
    restoreBackup(root, 'manual-1.db')
    const reopened = new Db(join(root, 'translator.db'))
    const row = reopened.prepare('SELECT v FROM t').get() as { v: string }
    expect(row.v).toBe('hello')
    reopened.close()
  })

  it('完整性检查：健康库返回 true', () => {
    const fresh = new Db(join(root, 'translator.db'))
    expect(integrityOk(fresh)).toBe(true)
    fresh.close()
  })
})
