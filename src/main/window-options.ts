// 主窗口参数（纯函数，便于单测）
//
// 关闭系统原生标题栏（frame:false），改由渲染层自绘 TitleBar：
// 原生标题栏颜色由系统决定，无法跟随应用内的深色/浅色与强调色，导致
// 顶部一条浅色栏与整体外观割裂。
import type { BrowserWindowConstructorOptions } from 'electron'

export interface MainWindowOptionsInput {
  preloadPath: string
  background: string
}

export const MAIN_WINDOW_WIDTH = 1100
export const MAIN_WINDOW_HEIGHT = 720
export const MAIN_WINDOW_MIN_WIDTH = 960
export const MAIN_WINDOW_MIN_HEIGHT = 640

export function mainWindowOptions({
  preloadPath,
  background
}: MainWindowOptionsInput): BrowserWindowConstructorOptions {
  return {
    width: MAIN_WINDOW_WIDTH,
    height: MAIN_WINDOW_HEIGHT,
    minWidth: MAIN_WINDOW_MIN_WIDTH,
    minHeight: MAIN_WINDOW_MIN_HEIGHT,
    show: false,
    frame: false, // 自绘标题栏，配色跟随应用主题
    autoHideMenuBar: true,
    title: '游戏翻译助手',
    backgroundColor: background,
    webPreferences: {
      preload: preloadPath,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  }
}
