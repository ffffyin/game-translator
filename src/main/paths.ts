import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

// 固定数据目录：%APPDATA%\GameTranslator（PRD 7.1）
export function setupDataDir(): string {
  const root = join(app.getPath('appData'), 'GameTranslator')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  // 让 userData 也指向该目录，保证各类缓存/状态集中
  app.setPath('userData', root)

  for (const sub of ['backups', 'exports', 'logs']) {
    const p = join(root, sub)
    if (!existsSync(p)) mkdirSync(p)
  }
  return root
}

export function dataFilePath(root: string, file: string): string {
  return join(root, file)
}
