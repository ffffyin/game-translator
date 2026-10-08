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
