import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTING_KEYS,
  isKnownSetting,
  LANGUAGES,
  TERM_LIBRARIES,
  TRANSLATION_STYLES,
  TOXIC_LEVELS,
  isToxicLevel,
  OCR_ENGINES,
  normalizeOcrEngine,
  canUseVision
} from '../../src/shared/defaults'
import { isValidHex } from '../../src/shared/colors'

describe('DEFAULT_SETTINGS', () => {
  it('包含 PRD 要求的关键设置且默认值合法', () => {
    expect(SETTING_KEYS).toContain('themeMode')
    expect(SETTING_KEYS).toContain('accentColor')
    expect(SETTING_KEYS).toContain('ocrEngine')
    expect(isValidHex(DEFAULT_SETTINGS.accentColor)).toBe(true)
    expect(['dark', 'light', 'system']).toContain(DEFAULT_SETTINGS.themeMode)
    expect(['local', 'vision', 'hybrid']).toContain(DEFAULT_SETTINGS.ocrEngine)
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
  it('嘴臭火力三档且默认标准嘴臭', () => {
    expect(TOXIC_LEVELS.map((l) => l.value)).toEqual(['mild', 'trash', 'nuclear'])
    expect(DEFAULT_SETTINGS.toxicLevel).toBe('trash')
    expect(SETTING_KEYS).toContain('toxicLevel')
    expect(isToxicLevel('nuclear')).toBe(true)
    expect(isToxicLevel('ultra')).toBe(false)
  })
  it('OCR 三通道：本地 / AI / 本地+AI 组合', () => {
    expect(OCR_ENGINES.map((l) => l.value)).toEqual(['local', 'vision', 'hybrid'])
    expect(OCR_ENGINES.find((o) => o.value === 'hybrid')!.note).toContain('本地优先')
  })

  it('normalizeOcrEngine 非法值回落 local', () => {
    expect(normalizeOcrEngine('hybrid')).toBe('hybrid')
    expect(normalizeOcrEngine('vision')).toBe('vision')
    expect(normalizeOcrEngine('local')).toBe('local')
    expect(normalizeOcrEngine('bogus')).toBe('local')
    expect(normalizeOcrEngine(undefined)).toBe('local')
  })

  it('canUseVision 需同时开启视觉能力并填写视觉模型', () => {
    expect(canUseVision({ vision_enabled: 1, vision_model: 'gpt-4o' })).toBe(true)
    expect(canUseVision({ vision_enabled: 1, vision_model: null })).toBe(false)
    expect(canUseVision({ vision_enabled: 0, vision_model: 'gpt-4o' })).toBe(false)
    expect(canUseVision(undefined)).toBe(false)
  })
})
