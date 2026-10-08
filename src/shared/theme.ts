export type ThemeName = 'dark' | 'light'
export type ThemeMode = 'dark' | 'light' | 'system'

// 根据主题模式与系统当前是否深色，解析出实际主题
export function resolveTheme(mode: string, systemDark: boolean): ThemeName {
  if (mode === 'dark' || mode === 'light') return mode
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return 'dark'
}

export function isThemeMode(mode: string): mode is ThemeMode {
  return mode === 'dark' || mode === 'light' || mode === 'system'
}

// 窗口底色（首帧绘制前的背景色），与渲染层 --bg 保持一致，避免启动闪白/闪黑
export const WINDOW_BG: Record<ThemeName, string> = {
  dark: '#161a21',
  light: '#eef0f3'
}

export function resolveWindowBackground(mode: string, systemDark: boolean): string {
  return WINDOW_BG[resolveTheme(mode, systemDark)]
}
