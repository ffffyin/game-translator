import { describe, it, expect } from 'vitest'
import { buildSystemPrompt, buildMessages } from '../../src/main/services/translate-prompt'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

describe('buildSystemPrompt', () => {
  it('包含目标语言与只输出译文的约束', () => {
    const p = buildSystemPrompt(DEFAULT_SETTINGS)
    expect(p).toContain('中文（简体）')
    expect(p).toContain('只输出译文本身')
  })

  it('自动检测模式包含源语言自动检测', () => {
    expect(buildSystemPrompt({ ...DEFAULT_SETTINGS, languageSource: 'auto' })).toContain(
      '源语言自动检测'
    )
  })

  it('四种风格各自包含对应指令', () => {
    expect(buildSystemPrompt({ ...DEFAULT_SETTINGS, translationStyle: 'daily' })).toContain(
      '日常的玩家口语'
    )
    expect(buildSystemPrompt({ ...DEFAULT_SETTINGS, translationStyle: 'pro' })).toContain(
      '职业电竞选手'
    )
    expect(buildSystemPrompt({ ...DEFAULT_SETTINGS, translationStyle: 'toxic' })).toContain(
      '嘴臭'
    )
    expect(buildSystemPrompt({ ...DEFAULT_SETTINGS, translationStyle: 'auto' })).toContain(
      '自动判断原文语气'
    )
  })

  it('包含东南亚式英语处理说明', () => {
    expect(buildSystemPrompt(DEFAULT_SETTINGS)).toContain('东南亚式英语')
  })

  it('注入术语对照', () => {
    const p = buildSystemPrompt(DEFAULT_SETTINGS, [
      { source_text: 'gg', target_text: '打得好' },
      { source_text: 'mid', target_text: '中路' }
    ])
    expect(p).toContain('gg：打得好')
    expect(p).toContain('mid：中路')
  })

  it('无术语时不出现术语段落标题', () => {
    expect(buildSystemPrompt(DEFAULT_SETTINGS)).not.toContain('术语对照')
  })
})

describe('buildMessages', () => {
  it('系统消息 + 用户消息结构正确', () => {
    const msgs = buildMessages({ text: 'gg wp', settings: DEFAULT_SETTINGS })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].role).toBe('system')
    expect(msgs[1]).toEqual({ role: 'user', content: 'gg wp' })
  })
})
