import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({ create: vi.fn() }))

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: hoisted.create } }
  }
}))
vi.mock('../../src/main/services/crypto', () => ({
  dpapiDecrypt: async (s: string) => s
}))

import { translateOcrLines, testConnection } from '../../src/main/services/translate'
import type { ModelConfig } from '../../shared/model'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

const config = {
  id: 1,
  name: 't',
  provider: 'deepseek',
  base_url: 'https://x/v1',
  api_key_enc: 'sk-x',
  text_model: 'm',
  vision_enabled: 0,
  vision_model: null,
  params_json: null,
  is_default: 1,
  created_at: '',
  updated_at: ''
} as ModelConfig

beforeEach(() => {
  hoisted.create.mockReset()
})

describe('translateOcrLines OCR 多行翻译', () => {
  it('输出行数一致：逐行一一对应', async () => {
    hoisted.create.mockResolvedValue({
      choices: [{ message: { content: '1. 中路\n2. 撤退\n3. 打龙' } }],
      usage: { prompt_tokens: 6, completion_tokens: 4 }
    })
    const r = await translateOcrLines({
      lines: ['mid', 'back', 'dragon'],
      config,
      settings: DEFAULT_SETTINGS
    })
    expect(r.pairs).toHaveLength(3)
    expect(r.pairs.map((p) => p.translation)).toEqual(['中路', '撤退', '打龙'])
    expect(r.pairs.map((p) => p.original)).toEqual(['mid', 'back', 'dragon'])
  })

  it('模型未遵守行数：退化为整段对应，信息不丢', async () => {
    hoisted.create.mockResolvedValue({
      choices: [{ message: { content: '只有两行译文' } }]
    })
    const r = await translateOcrLines({
      lines: ['a', 'b', 'c'],
      config,
      settings: DEFAULT_SETTINGS
    })
    expect(r.pairs).toHaveLength(1)
    expect(r.pairs[0].original).toBe('a\nb\nc')
    expect(r.pairs[0].translation).toContain('两行')
  })
})

describe('testConnection 测试连接', () => {
  it('请求成功返回连接成功', async () => {
    hoisted.create.mockResolvedValue({ choices: [] })
    const r = await testConnection(config)
    expect(r.ok).toBe(true)
    expect(r.message).toContain('成功')
  })

  it('请求失败透出错误原因', async () => {
    hoisted.create.mockImplementation(async () => {
      throw new Error('401 bad key')
    })
    const r = await testConnection(config)
    expect(r.ok).toBe(false)
    expect(r.message).toContain('401')
  })
})
