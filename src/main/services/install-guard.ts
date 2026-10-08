// 安装态数据守卫：保证「新安装的正式版」首次启动是空白默认设置
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEV_MARKER_FILE, shouldResetForCleanInstall } from '../../shared/data-dir'

// 主数据库及其 WAL/SHM 伴随文件
export const DB_FILE_NAMES = ['translator.db', 'translator.db-wal', 'translator.db-shm']

// 开发态启动时打标记（幂等）
export function markDevDataDir(root: string, version: string): string {
  const marker = join(root, DEV_MARKER_FILE)
  if (!existsSync(marker)) {
    writeFileSync(marker, `dev-build v${version} ${new Date().toISOString()}\n`, 'utf8')
  }
  return marker
}

// 清空数据库文件（不动 backups/ 与 exports/，便于用户自行还原）
export function wipeDatabaseFiles(root: string): string[] {
  const removed: string[] = []
  for (const name of DB_FILE_NAMES) {
    const p = join(root, name)
    if (existsSync(p)) {
      rmSync(p, { force: true })
      removed.push(name)
    }
  }
  return removed
}

// 正式版启动时调用：目录若被打过开发态标记，清空数据库并去掉标记，回到默认设置。
// 返回是否执行了清理。
export function ensureCleanInstallData(root: string, isPackaged: boolean): boolean {
  const marker = join(root, DEV_MARKER_FILE)
  if (!shouldResetForCleanInstall(isPackaged, existsSync(marker))) return false
  wipeDatabaseFiles(root)
  rmSync(marker, { force: true })
  return true
}
