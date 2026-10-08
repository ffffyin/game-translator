// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest'

describe('区域框选页 region/main.ts', () => {
  const regionSelect = vi.fn()
  const regionCancel = vi.fn()
  const regionReady = vi.fn()

  beforeAll(async () => {
    document.body.innerHTML =
      '<div id="sel" hidden><span id="size"></span></div><div id="tip">tip</div>'
    ;(window as unknown as { api: unknown }).api = {
      regionSelect,
      regionCancel,
      regionReady
    }
    await import('../../src/renderer/region/main.ts')
  })

  function fire(type: string, init: Record<string, number>): void {
    document.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))
  }

  it('脚本加载后通知主进程 region:ready', () => {
    expect(regionReady).toHaveBeenCalled()
  })

  it('正常拖拽结束后按选区矩形调用 regionSelect', () => {
    fire('mousedown', { button: 0, clientX: 100, clientY: 100 })
    fire('mousemove', { clientX: 250, clientY: 200 })
    fire('mousemove', { clientX: 400, clientY: 300 })
    fire('mouseup', { clientX: 400, clientY: 300 })
    expect(regionSelect).toHaveBeenCalledWith({
      x: 100,
      y: 100,
      width: 300,
      height: 200
    })
  })

  it('拖拽过程中更新选区尺寸标签', () => {
    expect(document.getElementById('size')!.textContent).toBe('300 × 200')
  })

  it('小于 8px 的选区视为误触，调用 regionCancel', () => {
    fire('mousedown', { button: 0, clientX: 500, clientY: 500 })
    fire('mouseup', { clientX: 503, clientY: 502 })
    expect(regionCancel).toHaveBeenCalled()
  })

  it('右键不开始框选', () => {
    regionSelect.mockClear()
    fire('mousedown', { button: 2, clientX: 10, clientY: 10 })
    fire('mouseup', { button: 2, clientX: 400, clientY: 400 })
    expect(regionSelect).not.toHaveBeenCalled()
  })

  it('按 ESC 调用 regionCancel', () => {
    regionCancel.mockClear()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(regionCancel).toHaveBeenCalled()
  })
})
