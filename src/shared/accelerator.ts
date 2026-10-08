// Electron Accelerator 规范化与冲突检测（纯逻辑，可单测）
const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super']

// 小写形式 → 规范名（大小写不敏感匹配）
const MODIFIER_CANON: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  super: 'Super',
  cmd: 'Super',
  command: 'Super',
  meta: 'Super',
  win: 'Super',
  windows: 'Super'
}

export interface AcceleratorParts {
  modifiers: string[]
  key: string
}

export function parseAccelerator(raw: string): AcceleratorParts | null {
  if (!raw || !raw.trim()) return null
  const tokens = raw
    .trim()
    .split('+')
    .map((t) => t.trim())
    .filter(Boolean)
  if (tokens.length === 0) return null

  const modifiers = new Set<string>()
  let key = ''
  for (const tok of tokens) {
    const canon = MODIFIER_CANON[tok.toLowerCase()]
    if (canon) {
      modifiers.add(canon)
    } else {
      if (key) return null // 两个非修饰键
      key = tok.length === 1 ? tok.toUpperCase() : tok
    }
  }
  if (!key) return null
  // 全局快捷键必须包含至少一个修饰键，避免劫持普通按键
  if (modifiers.size === 0) return null
  return {
    modifiers: MODIFIER_ORDER.filter((m) => modifiers.has(m)),
    key
  }
}

export function normalizeAccelerator(raw: string): string | null {
  const parts = parseAccelerator(raw)
  if (!parts) return null
  return [...parts.modifiers, parts.key].join('+')
}

export function describeAccelerator(raw: string): string {
  const norm = normalizeAccelerator(raw)
  return norm ?? ''
}

// 同一加速器被多个动作占用即冲突，返回冲突的加速器列表
export function findConflicts(entries: Array<{ accelerators: string }>): string[] {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const norm = normalizeAccelerator(e.accelerators)
    if (!norm) continue
    counts.set(norm, (counts.get(norm) ?? 0) + 1)
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([a]) => a)
}
