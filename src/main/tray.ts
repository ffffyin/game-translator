import { app, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

// 解析托盘图标：打包后位于 resources/icon.ico；开发环境用项目 build/icon.ico
function resolveTrayIcon() {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'icon.ico') : '',
    join(app.getAppPath(), 'build', 'icon.ico')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return nativeImage.createEmpty()
}

// getWindow 用取值函数传入：主窗口可能被销毁重建（macOS activate），
// 直接持有实例会在重建后操作已销毁的窗口
export function createTray(getWindow: () => unknown): Tray {
  const icon = resolveTrayIcon()
  const tray = new Tray(icon)
  tray.setToolTip('游戏翻译助手')

  const showWindow = (): void => {
    const win = getWindow() as { isDestroyed?: () => boolean; show?: () => void; focus?: () => void } | null
    if (!win) return
    if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return
    win.show?.()
    win.focus?.()
  }

  const menu = Menu.buildFromTemplate([
    { label: '打开主窗口', click: showWindow },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        // 走 app.quit() 而不是 app.exit(0)：before-quit 里的注销快捷键/关库才会执行
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', showWindow)
  return tray
}
