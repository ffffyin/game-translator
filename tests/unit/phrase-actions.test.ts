import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  pasteText: vi.fn(),
  pressEnter: vi.fn()
}))

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: hoisted.create } }
  }
}))
vi.mock('../../src/main/services/keystrokes', () => ({
  pasteText: hoisted.pasteText,
  pressEnter: hoisted.pressEnter
}))

import { applyMigrations } from '../../src/main/db/schema'
import { Db } from '../../src/main/services/db-wrapper'
import { ModelConfigService } from '../../src/main/services/model-config'
import { SettingsService } from '../../src/main/services/settings'
import { PhraseService, seedDefaultPhrases } from '../../src/main/services/phrases'
import { actionSendPhrase } from '../../src/main/services/phrase-actions'
import type { ModelConfigInput } from '../../src/shared/model'
import { join } from 'path'

const RESOURCES = join(__dirname, '..', '..', 'resources')

function fakeWin() {
  const send = vi.fn()
  const win = { webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

function notes(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls
    .filter((c) => c[0] === 'app:notify')
    .map((c) => c[1] as { type: string; message: string })
}

describe('常用语发送动作', () => {
  let db: Db
  let settings: SettingsService
  let phraseSvc: PhraseService

  beforeAll(async () => {
    db = new Db(':memory:')
    applyMigrations(db)
    settings = new SettingsService(db)
    phraseSvc = new PhraseService(db)
    seedDefaultPhrases(db, RESOURCES)
    const models = new ModelConfigService(db)
    const input: ModelConfigInput = {
      name: '测试模型',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-secret',
      text_model: 'deepseek-chat'
    }
    await models.create(input)
  })
  afterAll(() => db.close())

  beforeEach(() => {
    hoisted.create.mockReset()
    hoisted.pasteText.mockReset()
    hoisted.pressEnter.mockReset()
    // 默认：翻译开、回车关
    settings.set('phraseTranslateBeforeSend', 1)
    settings.set('phraseAutoEnter', 0)
  })

  it('翻译开但无模型：报错且不粘贴', async () => {
    // 临时删掉模型：通过新建独立 db 更简单，这里直接停用默认——改用第二个内存库
    const db2 = new Db(':memory:')
    applyMigrations(db2)
    seedDefaultPhrases(db2, RESOURCES)
    const p = new PhraseService(db2).list()[0]
    const { win, send } = fakeWin()
    await actionSendPhrase({ win, db: db2 }, p)
    expect(notes(send).some((n) => n.type === 'error' && n.message.includes('模型配置'))).toBe(true)
    expect(hoisted.pasteText).not.toHaveBeenCalled()
    db2.close()
  })

  it('翻译开：译文粘贴、不回车、记录用量', async () => {
    hoisted.create.mockResolvedValue({
      choices: [{ message: { content: '加倍了！' } }],
      usage: { prompt_tokens: 6, completion_tokens: 3 }
    })
    const p = phraseSvc.list()[0]
    const { win, send } = fakeWin()
    await actionSendPhrase({ win, db }, p)
    expect(hoisted.pasteText).toHaveBeenCalledWith('加倍了！')
    expect(hoisted.pressEnter).not.toHaveBeenCalled()
    expect(notes(send).some((n) => n.type === 'ok')).toBe(true)
    const usage = db.prepare("SELECT * FROM usage_logs WHERE kind='text'").all()
    expect(usage.length).toBe(1)
  })

  it('翻译关：原文直接粘贴，不请求模型', async () => {
    settings.set('phraseTranslateBeforeSend', 0)
    const p = phraseSvc.list()[0]
    const { win } = fakeWin()
    await actionSendPhrase({ win, db }, p)
    expect(hoisted.create).not.toHaveBeenCalled()
    expect(hoisted.pasteText).toHaveBeenCalledWith(p.content)
  })

  it('自动回车开：粘贴后回车并提示已发送', async () => {
    settings.set('phraseAutoEnter', 1)
    hoisted.create.mockResolvedValue({
      choices: [{ message: { content: '译文' } }],
      usage: { prompt_tokens: 2, completion_tokens: 2 }
    })
    const p = phraseSvc.list()[1]
    const { win, send } = fakeWin()
    await actionSendPhrase({ win, db }, p)
    expect(hoisted.pressEnter).toHaveBeenCalledTimes(1)
    expect(notes(send).some((n) => n.message.includes('已粘贴并发送'))).toBe(true)
  })

  it('翻译请求失败：透出错误且不粘贴', async () => {
    hoisted.create.mockRejectedValue(new Error('500 server error'))
    const p = phraseSvc.list()[0]
    const { win, send } = fakeWin()
    await actionSendPhrase({ win, db }, p)
    expect(notes(send).some((n) => n.message.includes('500'))).toBe(true)
    expect(hoisted.pasteText).not.toHaveBeenCalled()
  })
})
