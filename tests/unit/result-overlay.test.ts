import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const created: Array<Record<string, unknown>> = []
  function makeWin(): Record<string, unknown> {
    const wcEv: Record<string, (...a: unknown[]) => void> = {}
    const winEv: Record<string, (...a: unknown[]) => void> = {}
    const ipcHandlers: Record<string, (...a: unknown[]) => unknown> = {}
    const win = {
      close: vi.fn(),
      isDestroyed: vi.fn(() => false),
      loadFile: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      on: (e: string, cb: (...a: unknown[]) => void) => {
        winEv[e] = cb
      },
      once: (e: string, cb: (...a: unknown[]) => void) => {
        winEv[e] = cb
      },
      webContents: {
        send: vi.fn(),
        on: (e: string, cb: (...a: unknown[]) => void) => {
          wcEv[e] = cb
        },
        once: (e: string, cb: (...a: unknown[]) => void) => {
          wcEv[e] = cb
        },
        ipc: {
          handle: (ch: string, cb: (...a: unknown[]) => unknown) => {
            ipcHandlers[ch] = cb
          },
          on: vi.fn()
        }
      },
      _wcEv: wcEv,
      _winEv: winEv,
      _ipc: ipcHandlers
    }
    created.push(win)
    return win
  }
  return { created, makeWin }
})

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(() => m.makeWin()),
  screen: {
    getAllDisplays: () => [
      { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }
    ],
    getPrimaryDisplay: () => ({
      id: 1,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1
    })
  },
  clipboard: { writeText: vi.fn() }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { openResultOverlay, closeResultOverlay } from '../../src/main/services/result-overlay'
import type { ResultData } from '../../src/shared/result'

const anchor = { x: 10, y: 10, width: 200, height: 100 }

function resultData(): ResultData {
  return {
    directionLabel: '自动 → 中文',
    engine: 'local',
    pairs: [{ id: 1, original: 'gg', translation: '打得好' }],
    styleOptions: [],
    currentStyle: 'auto',
    engineOptions: [],
    currentEngine: 'local',
    canVision: false
  }
}

function open() {
  return openResultOverlay({
    anchor,
    displayId: 1,
    onRetranslate: async () => resultData()
  })
}

beforeEach(() => {
  m.created.length = 0
  closeResultOverlay()
})

describe('结果悬浮窗生命周期', () => {
  it('再次打开时先关闭上一个窗口，不会累积', () => {
    const a = open()
    const b = open()
    expect(m.created).toHaveLength(2)
    expect(m.created[0].close).toHaveBeenCalledTimes(1)
    expect(m.created[1].close).not.toHaveBeenCalled()
    a.close()
    b.close()
  })

  it('窗口关闭后不再被当作当前窗口', () => {
    const a = open()
    a.close()
    const b = open()
    // 已关闭的旧窗口不会被重复关闭
    expect(m.created[0].close).toHaveBeenCalledTimes(1)
    b.close()
  })

  it('载入完成前 setData 会排队，载入后发送', () => {
    const h = open()
    const win = m.created[0]
    h.setData(resultData())
    expect(win.webContents.send).not.toHaveBeenCalled()
    win._wcEv['did-finish-load']?.()
    expect(win.webContents.send).toHaveBeenCalledTimes(1)
    h.close()
  })

  it('重新翻译在窗口已销毁后不再发送数据', async () => {
    const h = open()
    const win = m.created[0]
    ;(win.isDestroyed as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const handler = win._ipc['result:retranslate'] as (...a: unknown[]) => Promise<unknown>
    const r = (await handler({}, { style: 'toxic', engine: 'local' })) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(win.webContents.send).not.toHaveBeenCalled()
    h.close()
  })
})
