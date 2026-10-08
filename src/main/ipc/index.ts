import type { BrowserWindow } from 'electron'
import { shell, dialog, app } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync } from 'fs'
import type { Db } from '../services/db'
import { closeDb } from '../services/db'
import { SettingsService } from '../services/settings'
import { ModelConfigService } from '../services/model-config'
import { UsageService } from '../services/usage'
import { HotkeyManager } from '../services/hotkey-manager'
import { TermLibraryService } from '../services/term-library'
import { buildExportJson, validateTermFile, importTermFile, type IoResult } from '../services/term-io'
import { checkForUpdates, applyUpdates } from '../services/term-update'
import { PhraseService } from '../services/phrases'
import { testConnection } from '../services/translate'
import { queryQuota } from '../services/quota'
import { translateText } from '../services/translate'
import { resolveGlossary } from '../services/term-match'
import { listBackups, createBackup, restoreBackup } from '../services/backup'
import { wipeDatabaseFiles } from '../services/install-guard'
import type { NotifyPayload } from '../../shared/api-contract'
import type { ModelConfigInput } from '../../shared/model'

export function registerIpc(
  win: BrowserWindow,
  db: Db,
  root: string,
  onPhrasesChanged: () => void = () => {}
): void {
  const settings = new SettingsService(db)
  const models = new ModelConfigService(db)
  const usage = new UsageService(db)
  const hotkeys = new HotkeyManager(db)
  const termLibs = new TermLibraryService(db)
  const phrases = new PhraseService(db)

  const handle = win.webContents.ipc

  handle.on('app:ping', (e) => e.reply('pong'))

  // 启动路由（供 preload 同步读取 --route= 参数）
  handle.on('app:getStartupRoute', (e) => {
    const a = process.argv
    const eq = a.find((x) => x.startsWith('--route='))
    e.returnValue = eq ? eq.split('=').slice(1).join('=') : ''
  })

  // 设置
  handle.handle('settings:getAll', () => settings.getAll())
  handle.handle('settings:set', (_e, key: string, value: unknown) => {
    const next = settings.set(key, value)
    if (key === 'autoStart') {
      app.setLoginItemSettings({ openAtLogin: Number(value) === 1 })
    }
    return next
  })
  handle.handle('app:openDataDir', async () => {
    await shell.openPath(join(root))
    return true
  })
  handle.handle('app:getDataDir', () => root)

  // 备份与恢复
  handle.handle('backup:list', () => listBackups(root))
  handle.handle('backup:create', () => {
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
    createBackup(root, db, `translator-manual-${stamp}.db`)
    return listBackups(root)
  })
  handle.handle('backup:restore', (_e, name: string) => {
    closeDb()
    restoreBackup(root, name)
    app.relaunch()
    app.exit(0)
  })

  // 恢复出厂设置：清空本机配置（模型/Key、术语库、常用语、快捷键、用量、设置），
  // 备份目录保留，清空后自动重启，回到空白默认设置。
  handle.handle('app:resetToDefaults', (): { ok: boolean; removed?: string[]; message?: string } => {
    try {
      closeDb()
      const removed = wipeDatabaseFiles(root)
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 300)
      return { ok: true, removed }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '清空失败' }
    }
  })

  // 主页手动测试卡：用当前方向/术语/风格组合翻译一段文字
  handle.handle(
    'app:testTranslate',
    async (_e, text: string): Promise<{ ok: boolean; translation?: string; error?: string }> => {
      try {
        const config = models.getDefault()
        if (!config) {
          return { ok: false, error: '请先在「模型配置」中添加并选择默认模型' }
        }
        const current = settings.getAll()
        const terms = resolveGlossary(db, current, text)
        const r = await translateText({ config, text, settings: current, terms })
        usage.log({
          kind: 'text',
          configId: config.id,
          engine: config.text_model,
          chars: text.length,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut
        })
        return { ok: true, translation: r.text }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : '翻译失败' }
      }
    }
  )

  // 模型配置
  handle.handle('models:list', () => models.list())
  handle.handle('models:get', (_e, id: number) => models.get(id))
  handle.handle('models:create', (_e, input: ModelConfigInput) => models.create(input))
  handle.handle('models:update', (_e, id: number, input: ModelConfigInput) =>
    models.update(id, input)
  )
  handle.handle('models:delete', (_e, id: number) => models.remove(id))
  handle.handle('models:setDefault', (_e, id: number) => models.setDefault(id))
  handle.handle('models:test', async (_e, id: number) => {
    const raw = models.getForEngine(id)
    if (!raw) return { ok: false, message: '配置不存在' }
    return testConnection(raw)
  })

  // 用量
  handle.handle('usage:totals', () => usage.totals())
  handle.handle('usage:totalsToday', () => usage.totalsToday())
  handle.handle('usage:byConfig', () => usage.byConfig())
  handle.handle('usage:aggregateDays', (_e, days: number) => usage.aggregateDays(days))

  // 额度查询
  handle.handle('quota:query', async (_e, id: number) => {
    const view = models.get(id)
    if (!view) return { configId: id, supported: false, checkedAt: new Date().toISOString(), error: '配置不存在' }
    return queryQuota(models, view)
  })
  handle.handle('quota:queryAll', async () => {
    const views = models.list()
    const results = []
    for (const v of views) results.push(await queryQuota(models, v))
    return results
  })

  // 快捷键
  handle.handle('hotkeys:getAll', () => hotkeys.getAll())
  handle.handle('hotkeys:rebind', (_e, actionCode: string, accelerator: string) =>
    hotkeys.rebind(actionCode, accelerator)
  )
  handle.handle('hotkeys:setEnabled', (_e, actionCode: string, enabled: boolean) =>
    hotkeys.setEnabled(actionCode, enabled)
  )

  // 术语库
  handle.handle('terms:listLibs', () => termLibs.listLibs())
  handle.handle('terms:listTerms', (_e, libId: number, search?: string) =>
    termLibs.listTerms(libId, search)
  )
  handle.handle('terms:countTerms', (_e, libId: number) => termLibs.countTerms(libId))
  handle.handle('terms:createLib', (_e, input: { name: string; game?: string }) =>
    termLibs.createLib(input)
  )
  handle.handle('terms:renameLib', (_e, id: number, name: string) => termLibs.renameLib(id, name))
  handle.handle('terms:deleteLib', (_e, id: number) => termLibs.deleteLib(id))
  handle.handle(
    'terms:createTerm',
    (_e, libId: number, input: { source_text: string; target_text: string; tag?: string }) =>
      termLibs.createTerm(libId, input)
  )
  handle.handle(
    'terms:updateTerm',
    (_e, id: number, input: { source_text: string; target_text: string; tag?: string }) =>
      termLibs.updateTerm(id, input)
  )
  handle.handle('terms:deleteTerm', (_e, id: number) => termLibs.deleteTerm(id))

  // 术语库导入 / 导出
  handle.handle('terms:exportLib', async (_e, id: number): Promise<IoResult> => {
    try {
      const lib = termLibs.getLib(id)
      const data = buildExportJson(db, id)
      const r = await dialog.showSaveDialog(win, {
        title: '导出术语库',
        defaultPath: `${lib.name}.json`,
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePath) return { ok: false, message: '已取消导出' }
      writeFileSync(r.filePath, JSON.stringify(data, null, 2), 'utf8')
      return { ok: true, message: `已导出 ${data.terms.length} 条到所选文件`, count: data.terms.length }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '导出失败' }
    }
  })

  handle.handle('terms:importLib', async (): Promise<IoResult> => {
    try {
      const r = await dialog.showOpenDialog(win, {
        title: '导入术语库',
        properties: ['openFile'],
        filters: [{ name: 'JSON 文件', extensions: ['json'] }]
      })
      if (r.canceled || !r.filePaths[0]) return { ok: false, message: '已取消导入' }
      const raw = JSON.parse(readFileSync(r.filePaths[0], 'utf8'))
      const v = validateTermFile(raw)
      if (!v.ok) return { ok: false, message: '文件格式错误：' + v.error }
      return importTermFile(db, v.data)
    } catch (err) {
      return { ok: false, message: err instanceof Error ? `导入失败：${err.message}` : '导入失败' }
    }
  })

  // 术语库联网更新
  handle.handle('terms:checkUpdates', async (_e, url: string) => {
    try {
      return { ok: true, updates: await checkForUpdates(db, url) }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '检查更新失败' }
    }
  })
  handle.handle('terms:applyUpdates', async (_e, url: string) => {
    try {
      const results = await applyUpdates(db, url)
      return {
        ok: true,
        message: results.length
          ? `已更新 ${results.length} 个术语库`
          : '所有术语库均为最新版本',
        results
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : '更新失败' }
    }
  })

  // 常用语
  handle.handle('phrases:list', () => phrases.list())
  handle.handle('phrases:create', async (_e, content: string) => {
    const id = phrases.create(content)
    onPhrasesChanged()
    return id
  })
  handle.handle('phrases:update', async (_e, id: number, content: string) => {
    phrases.updateContent(id, content)
    onPhrasesChanged()
  })
  handle.handle('phrases:setEnabled', async (_e, id: number, enabled: boolean) => {
    phrases.setEnabled(id, enabled)
    onPhrasesChanged()
  })
  handle.handle('phrases:remove', async (_e, id: number) => {
    phrases.remove(id)
    onPhrasesChanged()
  })
  handle.handle('phrases:move', async (_e, id: number, direction: 'up' | 'down') => {
    phrases.move(id, direction)
    onPhrasesChanged()
  })
}

export function notify(win: BrowserWindow, payload: NotifyPayload): void {
  win.webContents.send('app:notify', payload)
}
