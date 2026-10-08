import { describe, it, expect } from 'vitest'
import { isValidHex, normalizeHex, ACCENT_PRESETS } from '../../src/shared/colors'

describe('isValidHex', () => {
  it('接受带#与不带#的6位色值', () => {
    expect(isValidHex('#F2B24C')).toBe(true)
    expect(isValidHex('3cc7ab')).toBe(true)
  })
  it('拒绝非法色值', () => {
    expect(isValidHex('#12345')).toBe(false)
    expect(isValidHex('#GGGGGG')).toBe(false)
    expect(isValidHex('red')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })
})

describe('normalizeHex', () => {
  it('统一为大写并补#', () => {
    expect(normalizeHex('f2b24c')).toBe('#F2B24C')
    expect(normalizeHex('#3cc7ab')).toBe('#3CC7AB')
  })
})

describe('ACCENT_PRESETS', () => {
  it('每个预设都是合法色值', () => {
    expect(ACCENT_PRESETS.length).toBeGreaterThanOrEqual(5)
    for (const p of ACCENT_PRESETS) expect(isValidHex(p.value)).toBe(true)
  })
})
