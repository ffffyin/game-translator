import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelConfig } from '../../src/shared/model'

const hoisted = vi.hoisted(() => ({
  localOcr: vi.fn(),
  visionExtract: vi.fn()
}))

vi.mock('../../src/main/services/ocr-local', () => ({ localOcr: hoisted.localOcr }))
vi.mock('../../src/main/services/ocr-vision', () => ({ visionExtract: hoisted.visionExtract }))

import { recognizeText } from '../../src/main/services/ocr'

const png = Buffer.from('png-bytes')
const dataUrl = 'data:image/png;base64,xxx'

function localResult(text: string) {
  return {
    text,
    confidence: 88,
    lines: text ? [{ text, confidence: 88, bbox: null }] : []
  }
}

function visionResult(text: string) {
  return { ...localResult(text), tokensIn: 12, tokensOut: 3 }
}

const visionConfig = {
  id: 1,
  name: '视觉模型',
  provider: 'openai',
  base_url: 'https://api.example.com/v1',
  api_key: 'sk-x',
  text_model: 'gpt-4o-mini',
  vision_enabled: 1,
  vision_model: 'gpt-4o',
  is_default: 1
} as unknown as ModelConfig

const textOnlyConfig = { ...visionConfig, vision_enabled: 0, vision_model: null } as ModelConfig

describe('recognizeText 识别通道', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.localOcr.mockResolvedValue(localResult('gg noob'))
    hoisted.visionExtract.mockResolvedValue(visionResult('gg wp'))
  })

  it('local：只走本地 OCR，不消耗视觉额度', async () => {
    const r = await recognizeText({ engine: 'local', png, dataUrl, config: visionConfig })
    expect(r.engine).toBe('local')
    expect(r.text).toBe('gg noob')
    expect(hoisted.visionExtract).not.toHaveBeenCalled()
    expect(r.degraded).toBeFalsy()
  })

  it('vision：只走 AI 视觉', async () => {
    const r = await recognizeText({ engine: 'vision', png, dataUrl, config: visionConfig })
    expect(r.engine).toBe('vision')
    expect(r.text).toBe('gg wp')
    expect(hoisted.localOcr).not.toHaveBeenCalled()
  })

  it('vision 无配置时给出明确错误', async () => {
    await expect(
      recognizeText({ engine: 'vision', png, dataUrl, config: undefined })
    ).rejects.toThrow('模型配置')
  })

  it('hybrid：本地成功时不调用 AI 视觉', async () => {
    const r = await recognizeText({ engine: 'hybrid', png, dataUrl, config: visionConfig })
    expect(r.engine).toBe('local')
    expect(r.degraded).toBeFalsy()
    expect(hoisted.visionExtract).not.toHaveBeenCalled()
  })

  it('hybrid：本地识别不到文字时自动降级 AI 视觉并标记 degraded', async () => {
    hoisted.localOcr.mockResolvedValue(localResult('   '))
    const r = await recognizeText({ engine: 'hybrid', png, dataUrl, config: visionConfig })
    expect(r.engine).toBe('vision')
    expect(r.degraded).toBe(true)
    expect(r.text).toBe('gg wp')
    expect(hoisted.visionExtract).toHaveBeenCalledWith(visionConfig, dataUrl)
  })

  it('hybrid：本地识别抛错时同样降级 AI 视觉', async () => {
    hoisted.localOcr.mockRejectedValue(new Error('OCR 识别超时（eng）'))
    const r = await recognizeText({ engine: 'hybrid', png, dataUrl, config: visionConfig })
    expect(r.engine).toBe('vision')
    expect(r.degraded).toBe(true)
  })

  it('hybrid：没有可用视觉通道时抛出本地失败原因，不静默吞错', async () => {
    hoisted.localOcr.mockRejectedValue(new Error('OCR 识别超时（eng）'))
    await expect(
      recognizeText({ engine: 'hybrid', png, dataUrl, config: textOnlyConfig })
    ).rejects.toThrow('OCR 识别超时（eng）')
    expect(hoisted.visionExtract).not.toHaveBeenCalled()
  })

  it('hybrid：降级后 AI 也失败则抛出 AI 的错误', async () => {
    hoisted.localOcr.mockResolvedValue(localResult(''))
    hoisted.visionExtract.mockRejectedValue(new Error('视觉模型未返回内容'))
    await expect(
      recognizeText({ engine: 'hybrid', png, dataUrl, config: visionConfig })
    ).rejects.toThrow('视觉模型未返回内容')
  })

  it('非法引擎值回落 local', async () => {
    const r = await recognizeText({
      engine: 'bogus' as never,
      png,
      dataUrl,
      config: visionConfig
    })
    expect(r.engine).toBe('local')
    expect(hoisted.visionExtract).not.toHaveBeenCalled()
  })
})
