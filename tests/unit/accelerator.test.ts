import { describe, it, expect } from 'vitest'
import {
  parseAccelerator,
  normalizeAccelerator,
  describeAccelerator,
  findConflicts
} from '../../src/shared/accelerator'

describe('parseAccelerator', () => {
  it('解析修饰键与主键并排序', () => {
    const p = parseAccelerator('Alt+Ctrl+2')
    expect(p?.modifiers).toEqual(['Ctrl', 'Alt'])
    expect(p?.key).toBe('2')
  })
  it('别名映射', () => {
    expect(parseAccelerator('Control+A')?.modifiers).toEqual(['Ctrl'])
    expect(parseAccelerator('Cmd+B')?.modifiers).toEqual(['Super'])
  })
  it('拒绝非法输入', () => {
    expect(parseAccelerator('')).toBeNull()
    expect(parseAccelerator('Ctrl+A+B')).toBeNull()
    expect(parseAccelerator('Ctrl')).toBeNull()
  })
  it('拒绝无修饰键的单键（防止劫持普通按键）', () => {
    expect(parseAccelerator('A')).toBeNull()
    expect(parseAccelerator('bad')).toBeNull()
  })
})

describe('normalizeAccelerator', () => {
  it('统一格式', () => {
    expect(normalizeAccelerator('control+alt+1')).toBe('Ctrl+Alt+1')
    expect(normalizeAccelerator('shift+x')).toBe('Shift+X')
  })
})

describe('describeAccelerator', () => {
  it('返回可展示文本', () => {
    expect(describeAccelerator('Ctrl+Alt+1')).toBe('Ctrl+Alt+1')
    expect(describeAccelerator('bad')).toBe('')
  })
})

describe('findConflicts', () => {
  it('找出重复占用的组合键', () => {
    const conflicts = findConflicts([
      { accelerators: 'Ctrl+Alt+1' },
      { accelerators: 'control+alt+1' },
      { accelerators: 'Ctrl+Alt+2' }
    ])
    expect(conflicts).toEqual(['Ctrl+Alt+1'])
  })
  it('无冲突返回空', () => {
    expect(findConflicts([{ accelerators: 'Ctrl+Alt+1' }])).toEqual([])
  })
})
