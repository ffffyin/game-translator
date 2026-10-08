import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { BrowserWindow } from 'electron'

const hoisted = vi.hoisted(() => ({
  pickRegion: vi.fn(),
  captureDisplay: vi.fn(),
  captureDisplayAtCursor: vi.fn(),
  cropRegion: vi.fn(),
  limitMaxEdge: vi.fn((x: unknown) => x),
  toPngBuffer: vi.fn().mockReturnValue(Buffer.from('x')),
  toPngDataUrl: vi.fn().mockReturnValue('data:image/png;base64,x'),
  recognizeText: vi.fn(),
  translateOcrLines: vi.fn(),
  openResultOverlay: vi.fn().mockReturnValue({ setData: vi.fn(), close: vi.fn() }),
  notify: vi.fn()
}))

vi.mock('electron', () => ({
  screen: {
    getAllDisplays: () => [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }
    ]
  }
}))
vi.mock('../../src/main/services/region-overlay', () => ({ pickRegion: hoisted.pickRegion }))
vi.mock('../../src/main/services/screen-capture', () => ({
  captureDisplay: hoisted.captureDisplay,
  captureDisplayAtCursor: hoisted.captureDisplayAtCursor
}))
vi.mock('../../src/main/services/image', () => ({
  cropRegion: hoisted.cropRegion,
  limitMaxEdge: hoisted.limitMaxEdge,
  toPngBuffer: hoisted.toPngBuffer,
  toPngDataUrl: hoisted.toPngDataUrl
}))
vi.mock('../../src/main/services/ocr', () => ({ recognizeText: hoisted.recognizeText }))
vi.mock('../../src/main/services/translate', () => ({
  translateOcrLines: hoisted.translateOcrLines
}))
vi.mock('../../src/main/services/result-overlay', () => ({
  openResultOverlay: hoisted.openResultOverlay
}))

import { applyMigrations } from '../../src/main/db/schema'
import { Db } from '../../src/main/services/db-wrapper'
import { ModelConfigService } from '../../src/main/services/model-config'
import { SettingsService } from '../../src/main/services/settings'
import {
  actionRegionScreenshot,
  actionFullscreenScreenshot
} from '../../src/main/services/screenshot-actions'
import type { ModelConfigInput } from '../../src/shared/model'

const fakeImage = { crop: vi.fn(), toPNG: vi.fn() }

function ctx(): { win: BrowserWindow; db: Db; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn()
  const win = { webContents: { send } } as unknown as BrowserWindow
  return { win, db, send }
}

function notes(c: { send: ReturnType<typeof vi.fn> }): Array<{ type: string; message: string }> {
  return c.send.mock.calls
    .filter((call) => call[0] === 'app:notify')
    .map((call) => call[1])
}

let db: Db

describe('截图翻译动作（快捷键 3/4）', () => {
  beforeAll(() => {
    db = new Db(':memory:')
    applyMigrations(db)
  })
  afterAll(() => db.close())

  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.limitMaxEdge.mockImplementation((x: unknown) => x)
  })

  it('框选时 ESC 取消：静默终止，不识别不弹悬浮窗', async () => {
    hoisted.pickRegion.mockResolvedValue(null)
    const c = ctx()
    await actionRegionScreenshot(c)
    expect(hoisted.recognizeText).not.toHaveBeenCalled()
    expect(hoisted.openResultOverlay).not.toHaveBeenCalled()
  })

  it('未配置默认模型：给出明确错误提示', async () => {
    hoisted.pickRegion.mockResolvedValue({
      rect: { x: 10, y: 10, width: 100, height: 100 },
      scaleFactor: 1,
      displayId: 1
    })
    hoisted.cropRegion.mockReturnValue(fakeImage)
    const c = ctx()
    await actionRegionScreenshot(c)
    expect(notes(c).some((n) => n.type === 'error' && n.message.includes('模型配置'))).toBe(true)
    expect(hoisted.openResultOverlay).not.toHaveBeenCalled()
  })

  it('视觉通道但模型未启用视觉能力：提示改用本地 OCR', async () => {
    const models = new ModelConfigService(db)
    await models.create({
      name: '文本模型',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-x',
      text_model: 'deepseek-chat'
    })
    const settings = new SettingsService(db)
    await settings.set('ocrEngine', 'vision')

    hoisted.pickRegion.mockResolvedValue({
      rect: { x: 10, y: 10, width: 100, height: 100 },
      scaleFactor: 1,
      displayId: 1
    })
    hoisted.cropRegion.mockReturnValue(fakeImage)
    const c = ctx()
    await actionRegionScreenshot(c)
    expect(notes(c).some((n) => n.type === 'error' && n.message.includes('视觉'))).toBe(true)
  })

  it('识别结果为空：提示选区内包含聊天文字，不记录用量', async () => {
    const settings = new SettingsService(db)
    await settings.set('ocrEngine', 'local')
    hoisted.pickRegion.mockResolvedValue({
      rect: { x: 10, y: 10, width: 100, height: 100 },
      scaleFactor: 1,
      displayId: 1
    })
    hoisted.cropRegion.mockReturnValue(fakeImage)
    hoisted.recognizeText.mockResolvedValue({ engine: 'local', text: '', lines: [], tokensIn: 0 })
    const c = ctx()
    await actionRegionScreenshot(c)
    expect(notes(c).some((n) => n.type === 'error' && n.message.includes('未识别到文字'))).toBe(
      true
    )
  })

  it('区域翻译成功：打开悬浮窗并下发数据，记录视觉类用量', async () => {
    hoisted.pickRegion.mockResolvedValue({
      rect: { x: 10, y: 10, width: 100, height: 100 },
      scaleFactor: 1,
      displayId: 1
    })
    hoisted.cropRegion.mockReturnValue(fakeImage)
    hoisted.recognizeText.mockResolvedValue({
      engine: 'local',
      text: 'hi\nthere',
      lines: [
        { text: 'hi', confidence: 90 },
        { text: 'there', confidence: 90 }
      ],
      tokensIn: 3
    })
    hoisted.translateOcrLines.mockResolvedValue({
      pairs: [
        { original: 'hi', translation: '你好' },
        { original: 'there', translation: '那里' }
      ],
      tokensIn: 4,
      tokensOut: 2
    })
    const c = ctx()
    await actionRegionScreenshot(c)

    expect(hoisted.openResultOverlay).toHaveBeenCalledTimes(1)
    const handle = hoisted.openResultOverlay.mock.results[0].value
    expect(handle.setData).toHaveBeenCalledTimes(1)
    const data = handle.setData.mock.calls[0][0]
    expect(data.pairs).toHaveLength(2)
    expect(data.pairs[0]).toEqual({ id: 1, original: 'hi', translation: '你好' })

    const row = db.prepare('SELECT * FROM usage_logs ORDER BY id DESC LIMIT 1').get() as {
      kind: string
      tokens_in: number
      tokens_out: number
    }
    expect(row.kind).toBe('vision-shot')
    expect(row.tokens_in).toBe(7)
    expect(row.tokens_out).toBe(2)
    expect(notes(c).some((n) => n.type === 'ok')).toBe(true)
  })

  it('全屏翻译成功：以显示器矩形为锚点打开悬浮窗', async () => {
    hoisted.captureDisplayAtCursor.mockResolvedValue({
      image: fakeImage,
      displayId: 1,
      scaleFactor: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 }
    })
    hoisted.recognizeText.mockResolvedValue({
      engine: 'local',
      text: 'gg',
      lines: [{ text: 'gg', confidence: 90 }],
      tokensIn: 1
    })
    hoisted.translateOcrLines.mockResolvedValue({
      pairs: [{ original: 'gg', translation: '打得不错' }],
      tokensIn: 2,
      tokensOut: 1
    })
    const c = ctx()
    await actionFullscreenScreenshot(c)
    expect(hoisted.openResultOverlay).toHaveBeenCalledTimes(1)
    const args = hoisted.openResultOverlay.mock.calls[0][0]
    expect(args.anchor).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('识别/翻译过程抛错：错误原因透出，不产生悬浮窗', async () => {
    hoisted.pickRegion.mockResolvedValue({
      rect: { x: 10, y: 10, width: 100, height: 100 },
      scaleFactor: 1,
      displayId: 1
    })
    hoisted.cropRegion.mockReturnValue(fakeImage)
    hoisted.recognizeText.mockRejectedValue(new Error('OCR 初始化失败'))
    const c = ctx()
    await actionRegionScreenshot(c)
    expect(notes(c).some((n) => n.type === 'error' && n.message.includes('OCR 初始化失败'))).toBe(
      true
    )
    expect(hoisted.openResultOverlay).not.toHaveBeenCalled()
  })
})
