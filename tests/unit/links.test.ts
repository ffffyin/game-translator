import { describe, it, expect } from 'vitest'
import {
  AUTHOR_NAME,
  GITHUB_URL,
  GITHUB_HANDLE,
  QQ_NUMBER,
  BILIBILI_URL,
  BILIBILI_UID,
  DOUYIN_URL,
  CONTACT_LINKS,
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

  it('B 站主页指向 space.bilibili.com/12945227', () => {
    expect(BILIBILI_URL).toBe('https://space.bilibili.com/12945227')
    expect(BILIBILI_UID).toBe('12945227')
    expect(BILIBILI_URL).toContain(BILIBILI_UID)
  })

  it('抖音主页为 v.douyin.com 短链', () => {
    expect(DOUYIN_URL).toBe('https://v.douyin.com/VjbsvjE5RAQ/')
    expect(new URL(DOUYIN_URL).hostname).toBe('v.douyin.com')
  })

  it('全部主页地址都是可安全打开的 https', () => {
    for (const u of [GITHUB_URL, BILIBILI_URL, DOUYIN_URL]) {
      expect(isSafeExternalUrl(u)).toBe(true)
      expect(u.startsWith('https://')).toBe(true)
    }
  })

  it('联系方式列表顺序为 GitHub/B站/抖音/QQ，且长网址不出现在展示文案里', () => {
    expect(CONTACT_LINKS.map((c) => c.key)).toEqual(['github', 'bilibili', 'douyin', 'qq'])
    expect(CONTACT_LINKS.map((c) => c.label)).toEqual(['GitHub', '哔哩哔哩', '抖音', 'QQ'])
    for (const c of CONTACT_LINKS) {
      // 界面只显示简称：不出现完整网址（无协议头、无查询参数），且足够短
      expect(c.display.includes('https://')).toBe(false)
      expect(c.display.includes('?')).toBe(false)
      expect(c.display.length).toBeLessThanOrEqual(22)
    }
    // 三个主页可点击跳转，QQ 为复制
    expect(CONTACT_LINKS.filter((c) => c.action === 'open').map((c) => c.url)).toEqual([
      GITHUB_URL,
      BILIBILI_URL,
      DOUYIN_URL
    ])
    expect(CONTACT_LINKS.find((c) => c.key === 'qq')?.action).toBe('copy')
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
