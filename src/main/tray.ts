import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
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

export function createTray(win: BrowserWindow): Tray {
  const icon = resolveTrayIcon()
  const tray = new Tray(icon)
  tray.setToolTip('游戏翻译助手')

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      click: () => {
        win.show()
        win.focus()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        app.exit(0)
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    win.show()
    win.focus()
  })
  return tray
}
