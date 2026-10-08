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

// 快捷键 1：全选翻译并自动替换
export async function actionTranslateReplace(ctx: ActionContext): Promise<void> {
  const { win, db } = ctx
  const { settings, models, usage } = services(db)
  let original = ''
  let placeholderShown = false
  try {
    const config = models.getDefault()
    if (!config) {
      notify(win, { type: 'error', message: '请先在「模型配置」中添加并选择默认模型' })
      return
    }
    notify(win, { type: 'loading', message: '正在读取并翻译…' })
    original = await readSelectedText()
    if (!original) {
      notify(win, { type: 'error', message: '未读取到文本，请确认光标在聊天输入框' })
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
    notify(win, { type: 'ok', message: '已替换为译文' })
  } catch (err) {
    notify(win, {
      type: 'error',
      message: err instanceof Error ? err.message : '翻译失败'
    })
    // 占位已显示但翻译失败：把原文还原回输入框
    if (placeholderShown && original) {
      await selectAllText()
      await pasteText(original)
    }
  }
}

// 快捷键 2：全选翻译，译文进剪贴板（不改动输入框）
export async function actionTranslateClipboard(ctx: ActionContext): Promise<void> {
  const { win, db } = ctx
  const { settings, models, usage } = services(db)
  try {
    const config = models.getDefault()
    if (!config) {
      notify(win, { type: 'error', message: '请先在「模型配置」中添加并选择默认模型' })
      return
    }
    notify(win, { type: 'loading', message: '正在读取并翻译…' })
    const original = await readSelectedText()
    if (!original) {
      notify(win, { type: 'error', message: '未读取到文本，请确认光标在聊天输入框' })
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
    notify(win, { type: 'ok', message: '译文已复制到剪贴板' })
  } catch (err) {
    notify(win, {
      type: 'error',
      message: err instanceof Error ? err.message : '翻译失败'
    })
  }
}
