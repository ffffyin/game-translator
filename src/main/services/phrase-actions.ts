import type { BrowserWindow } from 'electron'
import type { Db } from './db'
import { SettingsService } from './settings'
import { ModelConfigService } from './model-config'
import { UsageService } from './usage'
import { translateText } from './translate'
import { resolveGlossary } from './term-match'
import { pasteText, pressEnter } from './keystrokes'
import { notify } from '../ipc'
import type { PhraseRow } from './phrases'

export interface PhraseActionContext {
  win: BrowserWindow
  db: Db
}

// 常用语发送：取话术 →（按开关）翻译 → 粘贴 →（按开关）回车
export async function actionSendPhrase(
  ctx: PhraseActionContext,
  phrase: PhraseRow
): Promise<void> {
  const { win, db } = ctx
  const settingsSvc = new SettingsService(db)
  const models = new ModelConfigService(db)
  const usage = new UsageService(db)

  try {
    const current = settingsSvc.getAll()
    let content = phrase.content

    if (current.phraseTranslateBeforeSend === 1) {
      const config = models.getDefault()
      if (!config) {
        notify(win, { type: 'error', message: '请先在「模型配置」中添加并选择默认模型，或关闭发送前翻译' })
        return
      }
      notify(win, { type: 'loading', message: '正在翻译常用语…' })
      const terms = resolveGlossary(db, current, content)
      const result = await translateText({ text: content, config, settings: current, terms })
      usage.log({
        configId: config.id,
        kind: 'text',
        engine: config.text_model,
        chars: content.length,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut
      })
      content = result.text
    }

    await pasteText(content)
    if (current.phraseAutoEnter === 1) {
      await pressEnter()
      notify(win, { type: 'ok', message: '常用语已粘贴并发送' })
    } else {
      notify(win, { type: 'ok', message: '常用语已粘贴到输入框' })
    }
  } catch (err) {
    notify(win, { type: 'error', message: err instanceof Error ? err.message : '常用语发送失败' })
  }
}
