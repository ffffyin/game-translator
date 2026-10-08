import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => {
  const trayInstances: Array<Record<string, unknown>> = []
  const images: Array<{ path: string; empty: boolean }> = []
  return {
    trayInstances,
    images,
    Tray: vi.fn(function (this: Record<string, unknown>, image: unknown) {
      const inst: Record<string, unknown> = {
        image,
        handlers: {},
        setToolTip: vi.fn(),
        setContextMenu: vi.fn()
      }
      inst.on = (ev: string, cb: unknown) => {
        ;(inst.handlers as Record<string, unknown>)[ev] = cb
      }
      trayInstances.push(inst)
      return inst
    }),
    Menu: { buildFromTemplate: vi.fn((tpl: unknown) => ({ tpl })) },
    nativeImage: {
      createFromPath: vi.fn((p: string) => {
        const img = { path: p, isEmpty: () => !p.endsWith('icon.ico') }
        images.push(img)
        return img
      }),
      createEmpty: vi.fn(() => ({ path: '', isEmpty: () => true }))
    },
    app: { getAppPath: () => process.cwd(), exit: vi.fn() }
  }
})

vi.mock('electron', () => ({
  app: m.app,
  Tray: m.Tray,
  Menu: m.Menu,
  nativeImage: m.nativeImage,
  BrowserWindow: vi.fn()
}))

import { createTray } from '../../src/main/tray'

const fakeWin = { show: vi.fn(), focus: vi.fn() }

beforeEach(() => {
  m.trayInstances.length = 0
  m.images.length = 0
  fakeWin.show.mockClear()
  fakeWin.focus.mockClear()
})

describe('createTray 系统托盘', () => {
  it('开发环境：resourcesPath 无图标时回落到 build/icon.ico，托盘拿到非空图标', () => {
    const tray = createTray(fakeWin as never)
    const used = (tray as unknown as { image: { path: string; isEmpty: () => boolean } }).image
    expect(used.isEmpty()).toBe(false)
    expect(used.path.replace(/\\/g, '/')).toContain('build/icon.ico')
  })

  it('设置“游戏翻译助手”提示与右键菜单', () => {
    const tray = createTray(fakeWin as never) as unknown as {
      setToolTip: ReturnType<typeof vi.fn>
      setContextMenu: ReturnType<typeof vi.fn>
    }
    expect(tray.setToolTip).toHaveBeenCalledWith('游戏翻译助手')
    expect(tray.setContextMenu).toHaveBeenCalledTimes(1)
  })

  it('左键点击托盘：显示并聚焦主窗口', () => {
    const tray = createTray(fakeWin as never) as unknown as {
      handlers: { click?: () => void }
    }
    tray.handlers.click?.()
    expect(fakeWin.show).toHaveBeenCalled()
    expect(fakeWin.focus).toHaveBeenCalled()
  })

  it('所有候选路径都不存在：使用空图标兜底，不抛异常', async () => {
    vi.resetModules()
    vi.doMock('fs', () => ({ existsSync: () => false }))
    const { createTray: makeTray } = await import('../../src/main/tray')
    expect(() => makeTray(fakeWin as never)).not.toThrow()
    const tray = makeTray(fakeWin as never) as unknown as { image: { isEmpty: () => boolean } }
    expect(tray.image.isEmpty()).toBe(true)
    vi.doUnmock('fs')
    vi.resetModules()
  })
})
