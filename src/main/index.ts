import { app, BrowserWindow, shell, Tray, ipcMain, dialog, nativeTheme } from 'electron'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { join } from 'path'
import { setupDataDir, dataDirRoot } from './paths'
import { mainWindowOptions } from './window-options'
import { resolveWindowBackground } from '../shared/theme'
import { openDb, safeOpenDb, closeDb, getDb } from './services/db'
import { registerIpc } from './ipc'
import { createTray } from './tray'
import { ensureCleanInstallData, wipeDatabaseFiles } from './services/install-guard'
import { SettingsService } from './services/settings'
import { HotkeyManager } from './services/hotkey-manager'
import { UsageService } from './services/usage'
import { actionTranslateReplace, actionTranslateClipboard } from './services/actions'
import { actionRegionScreenshot, actionFullscreenScreenshot } from './services/screenshot-actions'
import { runCaptureSelfcheck, runOverlaySelfcheck, runRegionSelfcheck } from './services/selfcheck'
import { registerOcrScheme, registerOcrProtocol } from './services/ocr-asset-protocol'
import { seedBuiltinTerms } from './services/term-library'
import { syncBuiltinTerms } from './services/term-update'
import { seedDefaultPhrases, PhraseService } from './services/phrases'
import { actionSendPhrase } from './services/phrase-actions'
import {
  dailyBackupIfNeeded,
  pruneDailyBackups,
  createBackup,
  listBackups,
  restoreBackup,
  integrityOk
} from './services/backup'
import { APP_VERSION } from '../shared/version'
import { isSafeExternalUrl } from '../shared/links'
import { initLogger, log, errToText } from './services/logger'

// 自定义协议特权必须在 app ready 之前注册
registerOcrScheme()

// 隐藏的 OCR 窗口不能被后台/遮挡节流，否则 wasm worker 消息会被挂起
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

process.on('uncaughtException', (e) => {
  log('ERROR', '未捕获异常：' + errToText(e))
})
process.on('unhandledRejection', (e) => {
  log('ERROR', '未处理的 Promise 拒绝：' + errToText(e))
})
import type { ActionContext } from './services/actions'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let hotkeyManager: HotkeyManager | null = null

function createWindow(): BrowserWindow {
  // 首帧底色跟随已保存的主题，避免启动时闪一下相反的颜色
  let background = resolveWindowBackground('dark', nativeTheme.shouldUseDarkColors)
  try {
    const mode = new SettingsService(getDb()).get('themeMode')
    background = resolveWindowBackground(mode, nativeTheme.shouldUseDarkColors)
  } catch {
    // 数据不可用时用深色默认值
  }

  const win = new BrowserWindow(
    mainWindowOptions({
      preloadPath: join(__dirname, '../preload/index.js'),
      background
    })
  )

  win.on('ready-to-show', () => win.show())

  // 自绘标题栏需要知道最大化状态（按钮图标与窗口行为同步）
  const pushMaximized = (): void => {
    if (!win.isDestroyed()) win.webContents.send('window:maximized', win.isMaximized())
  }
  win.on('maximize', pushMaximized)
  win.on('unmaximize', pushMaximized)

  win.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) void shell.openExternal(details.url)
    else log('WARN', `已拦截非法的 window.open 外链：${details.url}`)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 关闭按钮最小化到托盘（按设置）
  win.on('close', (e) => {
    try {
      const s = new SettingsService(getDb())
      if (s.get('minimizeToTray') === 1 && !isQuitting) {
        e.preventDefault()
        win.hide()
      }
    } catch {
      // db 不可用时按默认关闭流程处理
    }
  })

  return win
}

app.whenReady().then(async () => {
  initLogger(dataDirRoot())
  log('INFO', `启动 v${APP_VERSION} packaged=${app.isPackaged}`)
  try {
    electronApp.setAppUserModelId('com.fygod.gametranslator')

    // 全局启动路由监听：所有窗口（框选/结果/OCR）的 preload 都能同步拿到，
    // 避免 sendSync 无监听者时阻塞整个 preload
    ipcMain.removeAllListeners('app:getStartupRoute')
    ipcMain.on('app:getStartupRoute', (e) => {
      const eq = process.argv.find((x) => x.startsWith('--route='))
      e.returnValue = eq ? eq.split('=').slice(1).join('=') : ''
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const root = setupDataDir()
    // 安装态守卫：正式版若发现数据目录来自开发版，清空为空白默认设置
    if (ensureCleanInstallData(root, app.isPackaged)) {
      log('WARN', '检测到开发态数据目录残留，已清空为默认设置')
    }
  const db = safeOpenDb(root)

  // 数据库损坏检测：提示从备份还原（PRD 7.5）
  if (!db || !integrityOk(db)) {
    const backups = listBackups(root)
    if (backups.length) {
      const choice = await dialog.showMessageBox({
        type: 'error',
        title: '数据库已损坏',
        message: '检测到数据库损坏，请选择一个备份还原。',
        buttons: [...backups.slice(0, 6).map((b) => b.name), '退出'],
        cancelId: Math.min(backups.length, 6)
      })
      if (choice.response < Math.min(backups.length, 6)) {
        if (db) closeDb()
        restoreBackup(root, backups[choice.response].name)
        app.relaunch()
        app.exit(0)
        return
      }
    } else {
      await dialog.showErrorBox(
        '数据库已损坏',
        '没有可用备份。请删除数据目录后重启，或重新导入术语库。'
      )
    }
    if (db) closeDb()
    app.quit()
    return
  }

  // 每日首启自动备份并只保留 7 份
  dailyBackupIfNeeded(root, db)
  pruneDailyBackups(root, 7)

  // 版本升级前备份并记录版本
  const meta = db.prepare('SELECT app_version FROM app_meta WHERE id=1').get() as
    | { app_version: string | null }
    | undefined
  const oldVersion = meta?.app_version
  if (oldVersion && oldVersion !== APP_VERSION) {
    createBackup(root, db, `translator-pre-${oldVersion}-v${APP_VERSION}.db`)
  }
  db.prepare(
    `INSERT INTO app_meta (id, schema_version, app_version) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET app_version=excluded.app_version`
  ).run(1, APP_VERSION)

  // 开机自启按已保存设置同步给系统
  app.setLoginItemSettings({
    openAtLogin: new SettingsService(db).get('autoStart') === 1
  })

  // OCR 离线资产协议（ocr/ 下的 worker、wasm，以及 tessdata/ 语言数据）
  const resourcesRoot = app.isPackaged
    ? process.resourcesPath
    : join(app.getAppPath(), 'resources')
  registerOcrProtocol(resourcesRoot)

  // 内置术语库种子（幂等）→ 再按版本号对齐，保证升级后能拿到新增词条
  seedBuiltinTerms(db, resourcesRoot)
  const termSync = syncBuiltinTerms(db, resourcesRoot)
  if (termSync.updated.length) log('INFO', `内置术语库已更新：${termSync.updated.join(', ')}`)
  if (termSync.added.length) log('INFO', `内置术语库已新增：${termSync.added.join(', ')}`)
  // 用量日志归档：只保留最近 90 天明细
  try {
    const pruned = new UsageService(db).prune(90)
    if (pruned > 0) log('INFO', `用量日志归档：清理 ${pruned} 条`)
  } catch (e) {
    log('WARN', '用量日志归档失败：' + errToText(e))
  }
  // 常用语种子（幂等）
  seedDefaultPhrases(db, resourcesRoot)

  // 自检模式：抓取/OCR 或悬浮窗视觉核对，不走常规窗口
  const scFlag = process.argv.find((x) => x.startsWith('--selfcheck='))
  if (scFlag) {
    const mode = scFlag.split('=').slice(1).join('=')
    if (mode === 'capture') {
      const report = await runCaptureSelfcheck(root)
      console.log(report)
      closeDb()
      app.quit()
    } else if (mode === 'region') {
      const report = await runRegionSelfcheck(root)
      console.log(report)
      closeDb()
      app.quit()
    } else if (mode === 'overlay') {
      runOverlaySelfcheck()
    }
    return
  }

  mainWindow = createWindow()
  const phraseHandlerFor = (p: { id: number }): (() => void) => (): void => {
    const fresh = new PhraseService(db).get(p.id)
    if (fresh) void actionSendPhrase({ win: mainWindow!, db }, fresh)
  }

  const refreshPhraseHotkeys = (): void => {
    if (!hotkeyManager) return
    const r = hotkeyManager.refreshPhraseHotkeys(phraseHandlerFor)
    if (r.failures.length) console.warn('常用语快捷键注册失败：', r.failures)
  }

  // 窗口可能被销毁重建（macOS activate）：重建后必须重新注册 IPC，
  // 并让快捷键/常用语闭包里的 ctx.win 指向新窗口
  const ctx: ActionContext = { win: mainWindow, db }
  const attachMainWindow = (win: BrowserWindow): void => {
    mainWindow = win
    ctx.win = win
    registerIpc(win, db, root, refreshPhraseHotkeys)
  }
  attachMainWindow(mainWindow)
  tray = createTray(() => mainWindow)

  // 全局快捷键：种子 → 注册已实现动作
  hotkeyManager = new HotkeyManager(db)
  hotkeyManager.seed()
  const failures = hotkeyManager.registerAll({
    translate_replace: () => void actionTranslateReplace(ctx),
    translate_clipboard: () => void actionTranslateClipboard(ctx),
    capture_region: () => actionRegionScreenshot(ctx),
    capture_fullscreen: () => actionFullscreenScreenshot(ctx)
  })
  if (failures.length > 0) {
    console.warn('以下快捷键注册失败：', failures.join(', '))
  }
  const phraseReg = hotkeyManager.registerPhraseHotkeys(phraseHandlerFor)
  if (phraseReg.failures.length) console.warn('常用语快捷键注册失败：', phraseReg.failures)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      attachMainWindow(createWindow())
    }
    mainWindow?.show()
  })

    log('INFO', '启动完成')
  } catch (e) {
    log('ERROR', '启动失败：' + errToText(e))
    dialog.showErrorBox('启动失败', e instanceof Error ? e.message : String(e))
    app.exit(1)
  }
})

app.on('before-quit', () => {
  isQuitting = true
  hotkeyManager?.unregisterAll()
  tray?.destroy()
  tray = null
  closeDb()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
