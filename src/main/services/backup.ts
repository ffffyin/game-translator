// 数据库备份与恢复（PRD 7.4 / 7.5）
import { existsSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import type { Db } from './db'

export const DB_FILE = 'translator.db'

export interface BackupFile {
  name: string
  mtime: string
  size: number
}

const DAILY_RE = /^translator-\d{4}-\d{2}-\d{2}\.db$/

export function listBackups(root: string): BackupFile[] {
  const dir = join(root, 'backups')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((n) => n.endsWith('.db'))
    .map((name) => {
      const st = statSync(join(dir, name))
      return { name, mtime: st.mtime.toISOString(), size: st.size }
    })
    .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
}

// 将 WAL 合并进主库后复制，保证备份一致
export function createBackup(root: string, db: Db, fileName: string): string {
  db.pragma('wal_checkpoint(TRUNCATE)')
  const dir = join(root, 'backups')
  const target = join(dir, fileName)
  copyFileSync(join(root, DB_FILE), target)
  return target
}

// 每日首启备份；返回 null 表示今日已备份
export function dailyBackupIfNeeded(root: string, db: Db): string | null {
  const day = new Date().toISOString().slice(0, 10)
  const fileName = `translator-${day}.db`
  if (existsSync(join(root, 'backups', fileName))) return null
  return createBackup(root, db, fileName)
}

// 只保留最近 keep 份每日备份（版本升级备份不受影响）
export function pruneDailyBackups(root: string, keep = 7): void {
  const dir = join(root, 'backups')
  const daily = readdirSync(dir)
    .filter((n) => DAILY_RE.test(n))
    .sort()
  const extra = daily.slice(0, Math.max(0, daily.length - keep))
  for (const n of extra) unlinkSync(join(dir, n))
}

// 还原：调用方须先关闭数据库；备份直接覆盖主库，并清掉 WAL/SHM
export function restoreBackup(root: string, backupName: string): void {
  const src = join(root, 'backups', backupName)
  if (!existsSync(src)) throw new Error('备份文件不存在')
  // 先清 WAL/SHM（不存在则跳过）
  for (const suffix of ['-wal', '-shm']) {
    const p = join(root, DB_FILE + suffix)
    if (existsSync(p)) unlinkSync(p)
  }
  // copyFileSync 可直接覆盖已存在文件，无需先删除（避免 EBUSY）
  copyFileSync(src, join(root, DB_FILE))
}

export function integrityOk(db: Db): boolean {
  const row = db.pragmaGet('integrity_check') as { integrity_check: string } | undefined
  return row?.integrity_check === 'ok'
}
