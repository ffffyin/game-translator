import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'
import { resolveDataDirName } from '../shared/data-dir'
import { markDevDataDir } from './services/install-guard'

// 数据根目录：正式版 %APPDATA%\GameTranslator（PRD 7.1）；
// 开发版 %APPDATA%\GameTranslator-dev —— 与正式版隔离，避免开发时的配置混进安装版。
export function dataDirRoot(): string {
  return join(app.getPath('appData'), resolveDataDirName(app.isPackaged))
}

export function setupDataDir(): string {
  const root = dataDirRoot()
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  // 让 userData 也指向该目录，保证各类缓存/状态集中
  app.setPath('userData', root)

  for (const sub of ['backups', 'exports', 'logs']) {
    const p = join(root, sub)
    if (!existsSync(p)) mkdirSync(p)
  }

  // 开发态打标记：正式版据此把被开发版污染过的目录清空成空白默认设置
  if (!app.isPackaged) markDevDataDir(root, app.getVersion())

  return root
}

export function dataFilePath(root: string, file: string): string {
  return join(root, file)
}
