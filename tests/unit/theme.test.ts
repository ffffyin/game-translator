import { describe, it, expect } from 'vitest'
import { resolveTheme, isThemeMode, resolveWindowBackground, WINDOW_BG } from '../../src/shared/theme'

describe('resolveTheme', () => {
  it('深色/浅色模式直接返回自身', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('跟随系统模式按系统深浅解析', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('未知模式兜底深色', () => {
    expect(resolveTheme('weird', false)).toBe('dark')
  })
})

describe('isThemeMode', () => {
  it('识别合法模式', () => {
    expect(isThemeMode('dark')).toBe(true)
    expect(isThemeMode('light')).toBe(true)
    expect(isThemeMode('system')).toBe(true)
    expect(isThemeMode('other')).toBe(false)
  })
})

describe('窗口底色跟随主题（避免启动闪白/闪黑）', () => {
  it('深色用 #161a21，浅色用 #eef0f3，与 tokens.css 的 --bg 一致', () => {
    expect(resolveWindowBackground('dark', false)).toBe('#161a21')
    expect(resolveWindowBackground('light', true)).toBe('#eef0f3')
    expect(WINDOW_BG.dark).toBe('#161a21')
    expect(WINDOW_BG.light).toBe('#eef0f3')
  })

  it('follow system 时按系统深浅取色', () => {
    expect(resolveWindowBackground('system', true)).toBe('#161a21')
    expect(resolveWindowBackground('system', false)).toBe('#eef0f3')
  })
})
