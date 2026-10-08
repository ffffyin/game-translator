import { describe, it, expect } from 'vitest'
import { buildProgressPlaceholder } from '../../src/shared/progress'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

describe('buildProgressPlaceholder 进度占位文本', () => {
  it('按用户给定格式生成完整占位文本', () => {
    const text = buildProgressPlaceholder({
      ...DEFAULT_SETTINGS,
      languageSource: 'zh-CN',
      languageTarget: 'en',
      termLibrary: 'dota2',
      translationStyle: 'auto'
    })
    expect(text).toBe('游戏翻译助手翻译中...（zh→en | 场景:dota2 | 模式:auto）')
  })

  it('源语言为自动检测时方向标签为 auto', () => {
    const text = buildProgressPlaceholder({
      ...DEFAULT_SETTINGS,
      languageSource: 'auto',
      languageTarget: 'zh-CN',
      termLibrary: 'lol',
      translationStyle: 'pro'
    })
    expect(text).toBe('游戏翻译助手翻译中...（auto→zh | 场景:lol | 模式:pro）')
  })

  it('带地区码的语言只取主码（fr-FR → fr）', () => {
    const text = buildProgressPlaceholder({
      ...DEFAULT_SETTINGS,
      languageSource: 'fr-FR',
      languageTarget: 'en-US',
      termLibrary: 'pubg',
      translationStyle: 'daily'
    })
    expect(text).toContain('fr→en')
  })
})
