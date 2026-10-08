import { describe, it, expect } from 'vitest'
import { PROVIDER_TEMPLATES, findProvider } from '../../src/shared/providers'

describe('PROVIDER_TEMPLATES', () => {
  it('包含主流厂商与自定义', () => {
    const keys = PROVIDER_TEMPLATES.map((p) => p.provider)
    for (const k of ['openai', 'deepseek', 'moonshot', 'dashscope', 'zhipu', 'openrouter', 'custom']) {
      expect(keys).toContain(k)
    }
  })
  it('非自定义模板都有地址和至少一个模型', () => {
    for (const t of PROVIDER_TEMPLATES) {
      if (t.provider === 'custom') continue
      expect(t.baseUrl.startsWith('http')).toBe(true)
      expect(t.textModels.length).toBeGreaterThan(0)
    }
  })
  it('findProvider', () => {
    expect(findProvider('deepseek')?.name).toContain('DeepSeek')
    expect(findProvider('nope')).toBeUndefined()
  })
})
