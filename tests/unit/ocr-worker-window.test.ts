import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const created: Array<Record<string, unknown>> = []
  function makeWin(): Record<string, unknown> {
    const wc: Record<string, Array<(...a: unknown[]) => void>> = {}
    const winEv: Record<string, Array<(...a: unknown[]) => void>> = {}
    const win = {
      isDestroyed: vi.fn(() => false),
      loadFile: vi.fn(),
      close: vi.fn(),
      on: (e: string, cb: (...a: unknown[]) => void) => {
        ;(winEv[e] ||= []).push(cb)
      },
      once: (e: string, cb: (...a: unknown[]) => void) => {
        ;(winEv[e] ||= []).push(cb)
      },
      removeListener: vi.fn(),
      webContents: {
        send: vi.fn(),
        on: vi.fn(),
        once: (e: string, cb: (...a: unknown[]) => void) => {
          ;(wc[e] ||= []).push(cb)
        }
      },
      _wc: wc,
      _winEv: winEv
    }
    created.push(win)
    return win
  }
  return { created, makeWin }
})

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(() => m.makeWin()),
  ipcMain: { on: vi.fn() }
}))

import { recognizeViaRenderer } from '../../src/main/services/ocr-worker-window'

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

beforeEach(() => {
  m.created.length = 0
})

describe('OCR 隐藏窗口容错', () => {
  it('页面加载失败时抛出可读错误并关掉坏窗口', async () => {
    const p = recognizeViaRenderer(Buffer.from([1, 2, 3]), 'eng')
    await tick()
    m.created[0]._wc['did-fail-load'][0]({}, -6, 'ERR_FILE_NOT_FOUND')
    await expect(p).rejects.toThrow('OCR 窗口加载失败')
    expect(m.created[0].close).toHaveBeenCalled()
  })

  it('坏窗口不会留在缓存里：下次识别新建窗口', async () => {
    const p = recognizeViaRenderer(Buffer.from([1]), 'chi_sim')
    await tick()
    m.created[0]._wc['did-fail-load'][0]({}, -6, 'boom')
    await expect(p).rejects.toThrow()

    const p2 = recognizeViaRenderer(Buffer.from([1]), 'chi_sim')
    await tick()
    expect(m.created).toHaveLength(2)
    // 清理未完成的 Promise，避免未处理的 rejection
    m.created[1]._wc['did-fail-load'][0]({}, -6, 'stop')
    await expect(p2).rejects.toThrow()
  })

  it('识别途中窗口被关闭：立即失败，不等超时', async () => {
    const p = recognizeViaRenderer(Buffer.from([1]), 'eng')
    await tick()
    m.created[0]._wc['did-finish-load'][0]()
    await tick()
    expect(m.created[0].webContents.send).toHaveBeenCalledTimes(1)
    for (const cb of m.created[0]._winEv['closed']) cb()
    await expect(p).rejects.toThrow('OCR 窗口已关闭')
  })
})
