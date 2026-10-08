// 配色（PRD 5.6）
export interface AccentPreset {
  name: string
  value: string
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { name: '琥珀金', value: '#F2B24C' },
  { name: '青绿', value: '#3CC7AB' },
  { name: '海蓝', value: '#6AA6E0' },
  { name: '赤红', value: '#E2685E' },
  { name: '幻紫', value: '#B08CE8' }
]

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

export function isValidHex(input: string): boolean {
  return HEX_RE.test(input.trim())
}

// 归一化为 #RRGGBB
export function normalizeHex(input: string): string {
  const t = input.trim()
  return t.startsWith('#') ? t.toUpperCase() : `#${t.toUpperCase()}`
}
