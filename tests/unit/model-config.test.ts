import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { applyMigrations } from '../../src/main/db/schema'
import { ModelConfigService } from '../../src/main/services/model-config'
import { Db } from '../../src/main/services/db-wrapper'
import type { ModelConfigInput } from '../../src/shared/model'

describe('ModelConfigService', () => {
  let db: ReturnType<typeof openTestDb>
  let svc: ModelConfigService

  function openTestDb(file: string): Db {
    return new Db(file)
  }

  beforeAll(() => {
    db = openTestDb(':memory:')
    applyMigrations(db)
    svc = new ModelConfigService(db)
  })
  afterAll(() => db.close())

  it('初始列表为空', () => {
    expect(svc.list()).toEqual([])
  })

  it('创建第一条配置自动成为默认，且列表不暴露密文', async () => {
    const input: ModelConfigInput = {
      name: '测试模型',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'sk-secret-123',
      text_model: 'deepseek-chat'
    }
    const view = await svc.create(input)
    expect(view.is_default).toBe(1)
    expect(view.hasKey).toBe(true)
    expect(view).not.toHaveProperty('api_key_enc')
  })

  it('第二条默认不是默认', async () => {
    const view = await svc.create({
      name: '模型2',
      provider: 'openai',
      base_url: 'https://api.openai.com/v1',
      api_key: 'k2',
      text_model: 'gpt-4o-mini'
    })
    expect(view.is_default).toBe(0)
  })

  it('setDefault 切换默认且只有一个默认', async () => {
    const before = svc.list()
    const target = before.find((m) => m.is_default !== 1)!
    svc.setDefault(target.id)
    const after = svc.list()
    expect(after.filter((m) => m.is_default === 1).length).toBe(1)
    expect(after.find((m) => m.id === target.id)?.is_default).toBe(1)
  })

  it('更新时留空 Key 保留原 Key，可正常解密', async () => {
    const item = svc.list().find((m) => m.name === '测试模型')!
    await svc.update(item.id, {
      name: '测试模型改',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: '',
      text_model: 'deepseek-chat'
    })
    const key = await svc.getDecryptedKey(item.id)
    expect(key).toBe('sk-secret-123')
    expect(svc.get(item.id)?.name).toBe('测试模型改')
  })

  it('更新时提供新 Key 则替换', async () => {
    const item = svc.list().find((m) => m.name === '测试模型改')!
    await svc.update(item.id, {
      name: '测试模型改',
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      api_key: 'new-key-456',
      text_model: 'deepseek-chat'
    })
    expect(await svc.getDecryptedKey(item.id)).toBe('new-key-456')
  })

  it('删除默认模型后自动指定新的默认', async () => {
    const defaultId = svc.list().find((m) => m.is_default === 1)!.id
    svc.remove(defaultId)
    const defaults = svc.list().filter((m) => m.is_default === 1)
    expect(defaults.length).toBe(1)
  })

  it('删除不存在/全部后状态正确', () => {
    for (const m of svc.list()) svc.remove(m.id)
    expect(svc.list()).toEqual([])
    expect(svc.getDefault()).toBeUndefined()
  })
})
