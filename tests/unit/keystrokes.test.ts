import { describe, it, expect } from 'vitest'
import { READ_ALL_SCRIPT, parseSelectedText } from '../../src/main/services/keystrokes'

describe('readSelectedText 复制脚本', () => {
  it('复制前记录剪贴板基准值', () => {
    expect(READ_ALL_SCRIPT).toContain('$base = Get-ClipText')
  })

  it('只有剪贴板相对基准值发生变化才算读到了文本', () => {
    expect(READ_ALL_SCRIPT).toContain('$c -ne $base')
  })

  it('剪贴板未变化时用哨兵复探，确认无内容后还原用户剪贴板', () => {
    expect(READ_ALL_SCRIPT).toContain('__GT_NO_SELECTION__')
    expect(READ_ALL_SCRIPT).toContain('Set-Clipboard -Value $base')
    expect(READ_ALL_SCRIPT).toContain('Set-Clipboard -Value $sentinel')
  })

  it('仍然执行全选与复制', () => {
    expect(READ_ALL_SCRIPT).toContain("SendKeys('^a')")
    expect(READ_ALL_SCRIPT).toContain("SendKeys('^c')")
  })
})

describe('parseSelectedText', () => {
  it('去掉 BOM、统一换行并去除首尾空白', () => {
    expect(parseSelectedText('\uFEFFhi\r\nthere\r\n')).toBe('hi\nthere')
  })

  it('空输出返回空串', () => {
    expect(parseSelectedText('\r\n')).toBe('')
    expect(parseSelectedText('')).toBe('')
  })
})
