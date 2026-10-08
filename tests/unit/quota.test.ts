import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../src/main/services/crypto', () => ({
  dpapiEncrypt: async (s: string) => `enc:${s}`,
  dpapiDecrypt: async (s: string) => s.replace(/^enc:/, '')
}))

import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { ModelConfigService } from '../../src/main/services/model-config'
import { queryQuota, inferTemplateByHost } from '../../src/main/services/quota'
import type { ModelConfigInput } from '../../src/shared/model'

async function makeModel(
  models: ModelConfigService,
  provider: string,
  base_url: string,
  withKey = true
) {
  const input: ModelConfigInput = {
    name: provider + '模型',
    provider,
    base_url,
    text_model: 'm1',
    api_key: withKey ? 'sk-test' : undefined
  }
  return models.create(input)
}

describe('额度查询适配器', () => {
  let db: Db
  let models: ModelConfigService
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    db = new Db(':memory:')
    applyMigrations(db)
    models = new ModelConfigService(db)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    db.close()
  })

  it('无余额接口的厂商（OpenAI）返回不支持标记', async () => {
    const v = await makeModel(models, 'openai', 'https://api.openai.com/v1')
    const r = await queryQuota(models, v)
    expect(r.supported).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DeepSeek：URL 去掉 /v1，正确解析余额', async () => {
    const v = await makeModel(models, 'deepseek', 'https://api.deepseek.com/v1')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '10.05', granted_balance: '1', topped_up_balance: '9.05' }]
      })
    })
    const r = await queryQuota(models, v)
    expect(r.supported).toBe(true)
    expect(r.balanceText).toBe('10.05 CNY')
    expect(r.amount).toBe(10.05)
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toBe('https://api.deepseek.com/user/balance')
  })

  it('OpenRouter：剩余额度 = 总额 - 已用', async () => {
    const v = await makeModel(models, 'openrouter', 'https://openrouter.ai/api/v1')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { total_credits: 10, total_usage: 2.5 } })
    })
    const r = await queryQuota(models, v)
    expect(r.balanceText).toBe('$7.50')
  })

  it('中转站 newapi：subscription 减 usage（美分）', async () => {
    const v = await makeModel(models, 'custom', 'https://relay.example.com/v1')
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hard_limit_usd: 20, access_until: 1893456000 })
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ total_usage: 500 })
      })
    const r = await queryQuota(models, v)
    expect(r.balanceText).toBe('$15.00')
    expect(r.expiresAt).toBeTruthy()
  })

  it('未填写 Key：提示无法查询', async () => {
    const v = await makeModel(models, 'deepseek', 'https://api.deepseek.com/v1', false)
    const r = await queryQuota(models, v)
    expect(r.error).toContain('API Key')
  })

  it('HTTP 非 200：透出状态码', async () => {
    const v = await makeModel(models, 'deepseek', 'https://api.deepseek.com/v1')
    fetchMock.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const r = await queryQuota(models, v)
    expect(r.error).toContain('401')
  })

  it('返回结构无法解析：给出明确错误', async () => {
    const v = await makeModel(models, 'deepseek', 'https://api.deepseek.com/v1')
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    const r = await queryQuota(models, v)
    expect(r.error).toContain('无法解析')
  })

  it('网络异常：透出网络错误', async () => {
    const v = await makeModel(models, 'deepseek', 'https://api.deepseek.com/v1')
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'))
    const r = await queryQuota(models, v)
    expect(r.error).toContain('ENOTFOUND')
  })

  // —— 回归：用户用「自定义」模板却填官方地址（曾导致 HTTP 404） ——
  it('自定义模板 + DeepSeek 官方地址：按主机名纠偏，改走 /user/balance', async () => {
    const v = await makeModel(models, 'custom', 'https://api.deepseek.com/v1')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '88.8' }]
      })
    })
    const r = await queryQuota(models, v)
    expect(r.balanceText).toBe('88.8 CNY')
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.deepseek.com/user/balance')
  })

  it('自定义模板 + OpenRouter 官方地址：按主机名纠偏，改走 /credits', async () => {
    const v = await makeModel(models, 'custom', 'https://openrouter.ai/api/v1')
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: { total_credits: 10, total_usage: 2.5 } })
    })
    const r = await queryQuota(models, v)
    expect(r.balanceText).toBe('$7.50')
    expect(String(fetchMock.mock.calls[0][0])).toContain('/credits')
  })

  it('自定义中转站返回 404：回退探测 DeepSeek 风格余额并成功', async () => {
    const v = await makeModel(models, 'custom', 'https://relay.example.com/v1')
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ balance_infos: [{ currency: 'CNY', total_balance: '3.5' }] })
      })
    const r = await queryQuota(models, v)
    expect(r.balanceText).toBe('3.5 CNY')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://relay.example.com/user/balance')
  })

  it('自定义中转站 404 且无可用余额接口：给出可操作提示', async () => {
    const v = await makeModel(models, 'custom', 'https://relay.example.com/v1')
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    const r = await queryQuota(models, v)
    expect(r.error).toContain('404')
    expect(r.error).toContain('厂商模板')
  })

  it('主机名识别：命中官方域名返回模板，未知域名返回 undefined', () => {
    expect(inferTemplateByHost('https://api.deepseek.com/v1')?.provider).toBe('deepseek')
    expect(inferTemplateByHost('https://openrouter.ai/api/v1')?.provider).toBe('openrouter')
    expect(inferTemplateByHost('https://relay.example.com/v1')).toBeUndefined()
    expect(inferTemplateByHost('not-a-url')).toBeUndefined()
  })
})
