import { describe, it, expect } from 'vitest'
import { resolveTheme, isThemeMode } from '../../src/shared/theme'

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
