import type { BrowserWindow } from 'electron'
import { clipboard } from 'electron'
import type { Db } from './db'
import { SettingsService } from './settings'
import { ModelConfigService } from './model-config'
import { UsageService } from './usage'
import { translateText } from './translate'
import { resolveGlossary } from './term-match'
import { readSelectedText, pasteText, selectAllText } from './keystrokes'
import { notify } from '../ipc'
import { buildProgressPlaceholder } from '../../shared/progress'
import type { NotifyPayload } from '../../shared/api-contract'
import { log } from './logger'

export interface ActionContext {
  win: BrowserWindow
  db: Db
}

function services(db: Db) {
  return {
    settings: new SettingsService(db),
    models: new ModelConfigService(db),
    usage: new UsageService(db)
  }
}

// 快捷键 1/2 共用防重入：连按会把多次 PowerShell 按键模拟堆起来互相抢焦点
let busy = false

// 主窗口处于前台时基本是误触（此时用户并不在游戏里）：
// 否则会把本软件界面自己的内容全选复制走，甚至把译文粘进别的窗口
function appInForeground(win: BrowserWindow): boolean {
  try {
    return win.isFocused()
  } catch {
    return false
  }
}

// 快捷键 1：全选翻译并自动替换
export async function actionTranslateReplace(ctx: ActionContext): Promise<void> {
  const { win, db } = ctx
  log('INFO', '快捷键触发：全选翻译并替换（默认 Ctrl+Alt+1）')
  if (busy) {
    log('WARN', '上一次翻译仍在进行，忽略本次触发')
    return
  }
  if (appInForeground(win)) {
    notify(win, {
      type: 'info',
      message: '当前焦点在本软件窗口，请切到游戏内聊天框后再按快捷键'
    })
    return
  }
  busy = true

  const { settings, models, usage } = services(db)
  let original = ''
  let placeholderShown = false
  let settled = false
  // 终态通知（ok / error）：确保任何异常路径都不会漏发，界面不会一直停在"正在读取并翻译"
  const done = (payload: NotifyPayload): void => {
    settled = true
    notify(win, payload)
  }

  try {
    const config = models.getDefault()
    if (!config) {
      done({ type: 'error', message: '请先在「模型配置」中添加并选择默认模型' })
      return
    }
    notify(win, { type: 'loading', message: '正在读取并翻译…' })
    original = await readSelectedText()
    if (!original) {
      done({ type: 'error', message: '未读取到文本，请确认光标在聊天输入框' })
      return
    }
    const current = settings.getAll()
    const terms = resolveGlossary(db, current, original)
    // 先把原文替换为进度占位文本，让玩家知道翻译正在进行
    const placeholder = buildProgressPlaceholder(current)
    await pasteText(placeholder)
    placeholderShown = true
    const result = await translateText({ text: original, config, settings: current, terms })
    usage.log({
      configId: config.id,
      kind: 'text',
      engine: config.text_model,
      chars: original.length,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut
    })
    // 重新全选占位文本，用译文替换
    await selectAllText()
    await pasteText(result.text)
    placeholderShown = false
    done({ type: 'ok', message: '已替换为译文' })
  } catch (err) {
    log('ERROR', '全选翻译失败：' + (err instanceof Error ? err.message : String(err)))
    done({
      type: 'error',
      message: err instanceof Error ? err.message : '翻译失败'
    })
    // 占位已显示但翻译失败：把原文还原回输入框
    if (placeholderShown && original) {
      try {
        await selectAllText()
        await pasteText(original)
      } catch {
        // 还原失败不再抛出，界面已有错误提示
      }
    }
  } finally {
    busy = false
    if (!settled) done({ type: 'error', message: '翻译流程异常中断，请重试' })
  }
}

// 快捷键 2：全选翻译，译文进剪贴板（不改动输入框）
export async function actionTranslateClipboard(ctx: ActionContext): Promise<void> {
  const { win, db } = ctx
  log('INFO', '快捷键触发：全选翻译到剪贴板（默认 Ctrl+Alt+2）')
  if (busy) {
    log('WARN', '上一次翻译仍在进行，忽略本次触发')
    return
  }
  if (appInForeground(win)) {
    notify(win, {
      type: 'info',
      message: '当前焦点在本软件窗口，请切到游戏内聊天框后再按快捷键'
    })
    return
  }
  busy = true

  const { settings, models, usage } = services(db)
  let settled = false
  const done = (payload: NotifyPayload): void => {
    settled = true
    notify(win, payload)
  }

  try {
    const config = models.getDefault()
    if (!config) {
      done({ type: 'error', message: '请先在「模型配置」中添加并选择默认模型' })
      return
    }
    notify(win, { type: 'loading', message: '正在读取并翻译…' })
    const original = await readSelectedText()
    if (!original) {
      done({ type: 'error', message: '未读取到文本，请确认光标在聊天输入框' })
      return
    }
    const current = settings.getAll()
    const terms = resolveGlossary(db, current, original)
    const result = await translateText({ text: original, config, settings: current, terms })
    usage.log({
      configId: config.id,
      kind: 'text',
      engine: config.text_model,
      chars: original.length,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut
    })
    clipboard.writeText(result.text)
    done({ type: 'ok', message: '译文已复制到剪贴板' })
  } catch (err) {
    log('ERROR', '剪贴板翻译失败：' + (err instanceof Error ? err.message : String(err)))
    done({
      type: 'error',
      message: err instanceof Error ? err.message : '翻译失败'
    })
  } finally {
    busy = false
    if (!settled) done({ type: 'error', message: '翻译流程异常中断，请重试' })
  }
}
