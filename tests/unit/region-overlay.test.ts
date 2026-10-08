import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const m = vi.hoisted(() => {
  const ipcCh: Record<string, (...a: unknown[]) => void> = {}
  const wcEv: Record<string, (...a: unknown[]) => void> = {}
  const onceEv: Record<string, () => void> = {}
  const win = {
    close: vi.fn(),
    show: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    isDestroyed: () => false,
    loadFile: vi.fn(),
    once: (ev: string, cb: () => void) => {
      onceEv[ev] = cb
    },
    on: vi.fn(),
    webContents: {
      ipc: {
        on: (ch: string, cb: (...a: unknown[]) => void) => {
          ipcCh[ch] = cb
        },
        removeAllListeners: vi.fn()
      },
      on: (ev: string, cb: (...a: unknown[]) => void) => {
        wcEv[ev] = cb
      }
    }
  }
  return { ipcCh, wcEv, onceEv, win }
})

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(() => m.win),
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      id: 42
    })
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

import { pickRegion } from '../../src/main/services/region-overlay'

describe('pickRegion 框选窗安全机制', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    m.win.close.mockClear()
    m.win.show.mockClear()
    for (const k of Object.keys(m.ipcCh)) delete m.ipcCh[k]
    for (const k of Object.keys(m.wcEv)) delete m.wcEv[k]
    for (const k of Object.keys(m.onceEv)) delete m.onceEv[k]
  })
  afterEach(() => vi.useRealTimers())

  it('页面加载失败：自动关闭并返回 null，不遗留透明窗', async () => {
    const p = pickRegion()
    m.onceEv['ready-to-show']?.()
    m.wcEv['did-fail-load']?.()
    await expect(p).resolves.toBeNull()
    expect(m.win.close).toHaveBeenCalled()
  })

  it('兜底 ESC（before-input-event）：返回 null', async () => {
    const p = pickRegion()
    m.wcEv['before-input-view']?.()
    m.wcEv['before-input-event']?.(
      {},
      { key: 'Escape', type: 'keyDown' }
    )
    await expect(p).resolves.toBeNull()
    expect(m.win.close).toHaveBeenCalled()
  })

  it('安全超时：6 秒未收到 region:ready 自动关闭返回 null', async () => {
    const p = pickRegion()
    await vi.advanceTimersByTimeAsync(6000)
    await expect(p).resolves.toBeNull()
    expect(m.win.close).toHaveBeenCalled()
  })

  it('region:ready 后安全超时解除；正常选区返回结果', async () => {
    const p = pickRegion()
    m.ipcCh['region:ready']?.()
    m.onceEv['ready-to-show']?.()
    await vi.advanceTimersByTimeAsync(7000)
    m.ipcCh['region:select']?.(
      {},
      { x: 100, y: 100, width: 300, height: 200 }
    )
    const r = await p
    expect(r).not.toBeNull()
    expect(r!.displayId).toBe(42)
    expect(r!.rect.width).toBe(300)
  })
})
