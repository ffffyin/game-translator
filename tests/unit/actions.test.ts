import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const hoisted = vi.hoisted(() => ({
  create: vi.fn(),
  writeText: vi.fn(),
  readSelectedText: vi.fn(),
  pasteText: vi.fn(),
  selectAllText: vi.fn(),
  pressEnter: vi.fn()
}))

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: hoisted.create } }
  }
}))
vi.mock('electron', () => ({
  clipboard: { writeText: hoisted.writeText }
}))
vi.mock('../../src/main/services/keystrokes', () => ({
  readSelectedText: hoisted.readSelectedText,
  pasteText: hoisted.pasteText,
  selectAllText: hoisted.selectAllText,
  pressEnter: hoisted.pressEnter
}))

import { applyMigrations } from '../../src/main/db/schema'
import { ModelConfigService } from '../../src/main/services/model-config'
import {
  actionTranslateReplace,
  actionTranslateClipboard
} from '../../src/main/services/actions'
import type { ModelConfigInput } from '../../src/shared/model'
import { Db } from '../../src/main/services/db-wrapper'

function fakeWin() {
  const send = vi.fn()
  const win = { webContents: { send } } as unknown as BrowserWindow
  return { win, send }
}

function payloads(send: ReturnType<typeof vi.fn>) {
  return send.mock.calls
    .filter((c) => c[0] === 'app:notify')
    .map((c) => c[1] as { type: string; message: string })
}

describe('翻译动作（快捷键 1/2）', () => {
  let db: ReturnType<typeof newDb>
  let models: ModelConfigService

  function newDb(file: string): Db {
    return new Db(file)
  }

  function usageRows(n: number) {
    return db.prepare('SELECT * FROM usage_logs ORDER BY ts DESC LIMIT ?').all(n) as Array<{
      kind: string
      tokens_in: number
      tokens_out: number
    }>
  }

  beforeAll(() => {
    db = newDb(':memory:')
    applyMigrations(db)
    models = new ModelConfigService(db)
  })
  afterAll(() => db.close())

  beforeEach(() => {
    hoisted.create.mockReset()
    hoisted.writeText.mockReset()
    hoisted.readSelectedText.mockReset()
    hoisted.pasteText.mockReset()
    hoisted.selectAllText.mockReset()
  })

  it('未配置模型：动作 1 给出明确错误提示', async () => {
    const { win, send } = fakeWin()
    await actionTranslateReplace({ win, db })
    const notes = payloads(send)
    expect(notes.some((n) => n.type === 'error' && n.message.includes('模型配置'))).toBe(true)
  })

  it('未配置模型：动作 2 给出明确错误提示', async () => {
    const { win, send } = fakeWin()
    await actionTranslateClipboard({ win, db })
    const notes = payloads(send)
    expect(notes.some((n) => n.type === 'error' && n.message.includes('模型配置'))).toBe(true)
  })

  it('读取不到文本：提示确认光标位置', async () => {
    const input: ModelConfigInput = {
      name: '测试模型',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-secret-123',
      text_model: 'deepseek-chat'
    }
    await models.create(input)
    hoisted.readSelectedText.mockResolvedValue('')
    const { win, send } = fakeWin()
    await actionTranslateReplace({ win, db })
    const notes = payloads(send)
    expect(notes.some((n) => n.type === 'error' && n.message.includes('未读取到文本'))).toBe(true)
  })

  it('动作 2 成功：译文进剪贴板、记录用量、成功提示', async () => {
    hoisted.readSelectedText.mockResolvedValue('gg noob team')
    hoisted.create.mockResolvedValue({
      choices: [{ message: { content: '你好，队友' } }],
      usage: { prompt_tokens: 4, completion_tokens: 5 }
    })
    const { win, send } = fakeWin()
    await actionTranslateClipboard({ win, db })

    expect(hoisted.writeText).toHaveBeenCalledWith('你好，队友')
    expect(hoisted.pasteText).not.toHaveBeenCalled()
    const notes = payloads(send)
    expect(notes.some((n) => n.type === 'ok' && n.message.includes('剪贴板'))).toBe(true)

    const rows = usageRows(10)
    expect(rows.length).toBe(1)
    expect(rows[0].kind).toBe('text')
    expect(rows[0].tokens_in).toBe(4)
    expect(rows[0].tokens_out).toBe(5)
  })

  it('动作 1 成功：先粘贴进度占位，译文返回后全选并替换', async () => {
    hoisted.readSelectedText.mockResolvedValue('mid or feed')
    hoisted.create.mockResolvedValue({
      choices: [{ message: { content: '中路还是来支援' } }],
      usage: { prompt_tokens: 5, completion_tokens: 7 }
    })
    const { win, send } = fakeWin()
    await actionTranslateReplace({ win, db })

    // 第一次粘贴的是进度占位文本
    expect(hoisted.pasteText).toHaveBeenCalledTimes(2)
    const firstPaste = hoisted.pasteText.mock.calls[0][0]
    expect(firstPaste).toContain('游戏翻译助手翻译中')
    expect(firstPaste).toContain('场景:general')
    expect(firstPaste).toContain('模式:auto')
    // 译文返回后先全选再替换
    expect(hoisted.selectAllText).toHaveBeenCalledTimes(1)
    expect(hoisted.pasteText.mock.calls[1][0]).toBe('中路还是来支援')
    expect(hoisted.writeText).not.toHaveBeenCalled()
    const notes = payloads(send)
    expect(notes.some((n) => n.type === 'ok' && n.message.includes('已替换'))).toBe(true)
  })

  it('动作 1 翻译失败且占位已显示：把原文还原回输入框', async () => {
    hoisted.readSelectedText.mockResolvedValue('hello mate')
    hoisted.create.mockRejectedValue(new Error('500 server error'))
    const { win } = fakeWin()
    await actionTranslateReplace({ win, db })

    expect(hoisted.pasteText).toHaveBeenCalledTimes(2)
    expect(hoisted.pasteText.mock.calls[0][0]).toContain('翻译中')
    expect(hoisted.selectAllText).toHaveBeenCalledTimes(1)
    expect(hoisted.pasteText.mock.calls[1][0]).toBe('hello mate')
  })

  it('模型请求失败：错误提示透出原因，不记录用量', async () => {
    const before = usageRows(50).length
    hoisted.readSelectedText.mockResolvedValue('hello')
    hoisted.create.mockRejectedValue(new Error('401 invalid api key'))
    const { win, send } = fakeWin()
    await actionTranslateClipboard({ win, db })

    const notes = payloads(send)
    expect(notes.some((n) => n.type === 'error' && n.message.includes('401'))).toBe(true)
    expect(usageRows(50).length).toBe(before)
  })
})
