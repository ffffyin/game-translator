import { app, Tray, Menu, nativeImage, BrowserWindow } from 'electron'
import { join } from 'path'

export function createTray(win: BrowserWindow): Tray {
  // 优先使用 resources 图标，否则用一个空 nativeImage 兜底
  let icon
  try {
    icon = nativeImage.createFromPath(join(process.resourcesPath, 'icon.ico'))
    if (icon.isEmpty()) icon = nativeImage.createEmpty()
  } catch {
    icon = nativeImage.createEmpty()
  }

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
