import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { RegionRect } from '../../shared/region'

export interface RegionResult {
  rect: RegionRect // DIP，相对该显示器
  scaleFactor: number
  displayId: number
  bounds: { x: number; y: number; width: number; height: number } // 显示器物理边界
}

// 打开框选窗；用户确认返回选区，ESC/关闭返回 null
export function pickRegion(): Promise<RegionResult | null> {
  return new Promise((resolve) => {
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      fullscreen: false,
      alwaysOnTop: false,
      show: false, // 首帧绘制完成后再显示，避免渲染失败时透明窗吞掉鼠标
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })

    let settled = false
    let safetyTimer: NodeJS.Timeout | null = setTimeout(() => finish(null), 6000)
    const clearSafety = (): void => {
      if (safetyTimer) {
        clearTimeout(safetyTimer)
        safetyTimer = null
      }
    }
    const finish = (v: RegionResult | null): void => {
      if (settled) return
      settled = true
      clearSafety()
      win.webContents.ipc.removeAllListeners('region:select')
      win.webContents.ipc.removeAllListeners('region:cancel')
      win.webContents.ipc.removeAllListeners('region:ready')
      if (!win.isDestroyed()) win.close()
      resolve(v)
    }

    // 页面就绪：渲染与脚本均已运行，解除安全超时
    win.webContents.ipc.on('region:ready', () => clearSafety())
    win.webContents.ipc.on('region:select', (_e, rect: RegionRect) => {
      finish({
        rect,
        scaleFactor: display.scaleFactor,
        displayId: display.id,
        bounds: { ...display.bounds }
      })
    })
    win.webContents.ipc.on('region:cancel', () => finish(null))
    // 兜底 ESC：即使页面脚本未加载，Chromium 仍会派发输入事件
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'Escape' && input.type === 'keyDown') finish(null)
    })
    win.webContents.on('did-fail-load', () => finish(null))
    win.on('closed', () => finish(null))

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '') + '/region.html')
    } else {
      win.loadFile(join(__dirname, '../renderer/region.html'))
    }
  })
}
