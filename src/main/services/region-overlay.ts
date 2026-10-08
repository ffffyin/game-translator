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

    let settled = false
    const finish = (v: RegionResult | null): void => {
      if (settled) return
      settled = true
      win.webContents.ipc.removeAllListeners('region:select')
      win.webContents.ipc.removeAllListeners('region:cancel')
      if (!win.isDestroyed()) win.close()
      resolve(v)
    }

    win.webContents.ipc.on('region:select', (_e, rect: RegionRect) => {
      finish({
        rect,
        scaleFactor: display.scaleFactor,
        displayId: display.id,
        bounds: { ...display.bounds }
      })
    })
    win.webContents.ipc.on('region:cancel', () => finish(null))
    win.on('closed', () => finish(null))

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '') + '/region.html')
    } else {
      win.loadFile(join(__dirname, '../renderer/region.html'))
    }
  })
}
