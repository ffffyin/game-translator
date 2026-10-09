import type { BrowserWindow } from 'electron'
import { shell, dialog, app } from 'electron'
import { join } from 'path'
import { writeFileSync, readFileSync } from 'fs'
import type { Db } from '../services/db'
import { closeDb, getDb } from '../services/db'
import { CloudService } from '../services/cloud'
import { SettingsService } from '../services/settings'
import { ModelConfigService } from '../services/model-config'
import { UsageService } from '../services/usage'
import { HotkeyManager } from '../services/hotkey-manager'
import { TermLibraryService } from '../services/term-library'
import { buildExportJson, validateTermFile, importTermFile, type IoResult } from '../services/term-io'
import { checkForUpdates, applyUpdates } from '../services/term-update'
import { checkForUpdate } from '../services/updater'
import { PhraseService } from '../services/phrases'
import { testConnection } from '../services/translate'
import { queryQuota } from '../services/quota'
import { translateText } from '../services/translate'
import { resolveGlossary } from '../services/term-match'
import { listBackups, createBackup, restoreBackup } from '../services/backup'
import { wipeDatabaseFiles } from '../services/install-guard'
import { isSafeExternalUrl } from '../../shared/links'
import type { NotifyPayload } from '../../shared/api-contract'
import type { ModelConfigInput } from '../../shared/model'
import type {
  AccountChangePasswordInput,
  AccountResetInput,
  AccountSignInInput,
  AccountSignUpInput
} from '../../shared/account'

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
  // 云服务初始化不阻塞界面：失败也不影响任何本地功能，登录是加成不是门槛
  const cloud = new CloudService(root, getDb)
  void cloud.init()

  const handle = win.webContents.ipc

  handle.on('app:ping', (e) => e.reply('pong'))

  // 启动路由（供 preload 同步读取 --route= 参数）
  handle.on('app:getStartupRoute', (e) => {
    const a = process.argv
    const eq = a.find((x) => x.startsWith('--route='))
    e.returnValue = eq ? eq.split('=').slice(1).join('=') : ''
  })

  // 自绘标题栏的窗口控制（frame:false 后系统不再提供按钮）
  handle.on('window:minimize', () => win.minimize())
  handle.on('window:toggleMaximize', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  // 走 close() 而非 destroy()，保留“最小化到托盘”的设置行为
  handle.on('window:close', () => win.close())
  handle.handle('window:isMaximized', () => win.isMaximized())

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
  // 用系统浏览器打开外链（只允许 http/https）
  handle.handle('app:openExternal', async (_e, url: string) => {
    if (!isSafeExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })

  // 软件更新：只做告知 + 引导下载（返回 UpdateCheckResult，失败也用返回值表达）
  handle.handle('app:checkUpdate', () => checkForUpdate())
  // 「前往下载」走系统浏览器；同样只放行 http/https
  handle.handle('app:openDownload', async (_e, url: string) => {
    if (!isSafeExternalUrl(url)) return false
    await shell.openExternal(url)
    return true
  })

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

  // 常用语分页
  handle.handle('phrases:listPages', () => phrases.listPages())
  handle.handle('phrases:createPage', (_e, input: { name: string; note?: string }) =>
    phrases.createPage(input.name, input.note)
  )
  handle.handle('phrases:updatePage', (_e, id: number, patch: { name?: string; note?: string }) => {
    phrases.updatePage(id, patch)
    onPhrasesChanged()
  })
  handle.handle('phrases:removePage', (_e, id: number) => {
    const r = phrases.removePage(id)
    if (r.ok) onPhrasesChanged()
    return r
  })
  // 切换当前页：Alt+1~8 立刻改绑到新页的槽位
  handle.handle('phrases:setActivePage', (_e, id: number) => {
    phrases.setActivePage(id)
    onPhrasesChanged()
  })

  // 常用语
  handle.handle('phrases:list', (_e, pageId?: number) => phrases.list(pageId))
  handle.handle('phrases:create', async (_e, pageId: number, content: string) => {
    const id = phrases.create(content, pageId)
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

  // 云端账号与配置同步（全部走异步，失败一律返回 ok:false + 中文原因，不抛给界面）
  // 启动门控：必须在 cloudStatus 之前调用一次，它决定这一趟要不要停在登录页
  handle.handle('cloud:prepareBoot', () => cloud.prepareBoot())
  handle.handle('cloud:status', () => cloud.status())
  // 登录框预填 / 取消勾选时立刻删除密文（密码只在内存里走一趟，不落盘不进日志）
  handle.handle('cloud:savedPassword', () => cloud.takeSavedPassword())
  handle.handle('cloud:forgetSavedPassword', () => cloud.forgetSavedPassword())
  handle.handle('cloud:localSummary', () => cloud.localSummary())
  handle.handle('cloud:sendOtp', (_e, email: string, usage: 'register' | 'reset') =>
    cloud.sendOtp(email, usage === 'reset' ? 'reset' : 'register')
  )
  handle.handle('cloud:signIn', (_e, input: AccountSignInInput) => cloud.signIn(input))
  handle.handle('cloud:signUp', (_e, input: AccountSignUpInput) => cloud.signUp(input))
  handle.handle('cloud:resetPassword', (_e, input: AccountResetInput) =>
    cloud.resetPassword(input)
  )
  handle.handle('cloud:changePassword', (_e, input: AccountChangePasswordInput) =>
    cloud.changePassword(input)
  )
  handle.handle('cloud:signOut', () => cloud.signOut())
  handle.handle('cloud:push', async () => {
    const r = await cloud.push()
    if (r.ok) onPhrasesChanged()
    return r
  })
  handle.handle('cloud:pull', async () => {
    const r = await cloud.pull()
    if (r.ok) onPhrasesChanged()
    return r
  })
  handle.handle('cloud:removeRemote', () => cloud.removeRemote())
}

export function notify(win: BrowserWindow, payload: NotifyPayload): void {
  win.webContents.send('app:notify', payload)
}
