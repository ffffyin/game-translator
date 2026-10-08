import { describe, it, expect } from 'vitest'
import {
  AUTHOR_NAME,
  GITHUB_URL,
  GITHUB_HANDLE,
  QQ_NUMBER,
  isSafeExternalUrl
} from '../../src/shared/links'

describe('作者联系方式', () => {
  it('GitHub 地址与展示文案', () => {
    expect(GITHUB_URL).toBe('https://github.com/ffffyin')
    expect(GITHUB_HANDLE).toBe('github.com/ffffyin')
    expect(AUTHOR_NAME).toBe('fygod')
  })

  it('QQ 号为纯数字字符串', () => {
    expect(QQ_NUMBER).toBe('316606176')
    expect(QQ_NUMBER).toMatch(/^\d+$/)
  })
})

describe('外链协议校验', () => {
  it('允许 http / https', () => {
    expect(isSafeExternalUrl(GITHUB_URL)).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
  })

  it('拒绝其他协议与非法地址', () => {
    expect(isSafeExternalUrl('file:///C:/Windows/system32/calc.exe')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('mailto:a@b.c')).toBe(false)
    expect(isSafeExternalUrl('not a url')).toBe(false)
    expect(isSafeExternalUrl('')).toBe(false)
  })
})
