import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  isKnownSetting,
  LANGUAGES,
  TERM_LIBRARIES,
  TRANSLATION_STYLES,
  OCR_ENGINES
} from '../../src/shared/defaults'
import { isValidHex } from '../../src/shared/colors'

describe('DEFAULT_SETTINGS', () => {
  it('包含 PRD 要求的关键设置且默认值合法', () => {
    expect(SETTING_KEYS).toContain('themeMode')
    expect(SETTING_KEYS).toContain('accentColor')
    expect(SETTING_KEYS).toContain('ocrEngine')
    expect(isValidHex(DEFAULT_SETTINGS.accentColor)).toBe(true)
    expect(['dark', 'light', 'system']).toContain(DEFAULT_SETTINGS.themeMode)
    expect(['local', 'vision']).toContain(DEFAULT_SETTINGS.ocrEngine)
  })

  it('isKnownSetting 识别已定义键', () => {
    expect(isKnownSetting('themeMode')).toBe(true)
    expect(isKnownSetting('nope')).toBe(false)
  })
})

describe('界面选项常量', () => {
  it('语言含自动检测与中英日法', () => {
    const vals = LANGUAGES.map((l) => l.value)
    for (const v of ['auto', 'zh-CN', 'en', 'ja', 'fr']) expect(vals).toContain(v)
  })
  it('术语库含四款游戏与通用', () => {
    const vals = TERM_LIBRARIES.map((l) => l.value)
    for (const v of ['general', 'dota2', 'lol', 'pubg', 'cs2']) expect(vals).toContain(v)
  })
  it('翻译风格四种', () => {
    expect(TRANSLATION_STYLES.map((l) => l.value)).toEqual(['auto', 'daily', 'pro', 'toxic'])
  })
  it('OCR 双通道', () => {
    expect(OCR_ENGINES.map((l) => l.value)).toEqual(['local', 'vision'])
  })
})
