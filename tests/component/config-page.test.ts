// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConfigPage from '../../src/renderer/pages/ConfigPage.vue'
import type { ModelConfigView } from '../../src/shared/model'

function makeView(id: number, patch: Partial<ModelConfigView> = {}): ModelConfigView {
  return {
    id,
    name: '模型' + id,
    provider: 'deepseek',
    base_url: 'https://api.deepseek.com/v1',
    text_model: 'deepseek-chat',
    vision_enabled: 0,
    vision_model: null,
    params_json: null,
    is_default: id === 1 ? 1 : 0,
    hasKey: true,
    created_at: '2026-10-08 10:00:00',
    updated_at: '2026-10-08 10:00:00',
    ...patch
  }
}

let store: ModelConfigView[] = []
let seq = 100

function installApi() {
  const api = {
    modelsList: vi.fn(async () => structuredClone(store)),
    modelsCreate: vi.fn(async () => ({ id: ++seq })),
    modelsUpdate: vi.fn(async () => undefined),
    modelsDelete: vi.fn(async (id: number) => {
      store = store.filter((m) => m.id !== id)
    }),
    modelsSetDefault: vi.fn(async (id: number) => {
      store.forEach((m) => (m.is_default = m.id === id ? 1 : 0))
    }),
    modelsTest: vi.fn(async () => ({ ok: true, message: '连接成功（123ms）' }))
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

function mountPage() {
  return mount(ConfigPage, {
    global: { plugins: [createPinia()] }
  })
}

beforeEach(() => {
  store = [makeView(1), makeView(2, { is_default: 0 })]
  seq = 100
})

describe('ConfigPage 模型配置页', () => {
  it('初始加载列表，首项进入编辑态', async () => {
    installApi()
    const w = mountPage()
    await vi.waitFor(() => {
      expect(w.text()).toContain('模型1')
      expect(w.text()).toContain('模型2')
    })
    expect(w.findAll('.model-item').length).toBe(2)
    expect(w.find('.model-item.on').exists()).toBe(true)
    expect(w.find('.m-card').text()).toContain('编辑模型配置')
  })

  it('新建：填表保存后列表新增', async () => {
    const api = installApi()
    const w = mountPage()
    await vi.waitFor(() => expect(w.text()).toContain('模型1'))

    await w.find('.new-btn').trigger('click')
    expect(w.find('.m-card').text()).toContain('新建模型配置')

    const inputs = w.findAll('.right input')
    await inputs[0].setValue('我的新模型') // 配置名称
    await inputs[1].setValue('https://api.example.com/v1') // API 地址
    await inputs[2].setValue('sk-abc') // API Key
    await inputs[3].setValue('example-translate') // 文本模型

    await w.findAll('.actions button').find((b) => b.text() === '保存')!.trigger('click')
    await vi.waitFor(() => expect(api.modelsCreate).toHaveBeenCalled())
    await vi.waitFor(() => expect(w.find('.test-msg.ok').text()).toContain('已保存'))
  })

  it('测试连接：展示成功结果', async () => {
    const api = installApi()
    const w = mountPage()
    await vi.waitFor(() => expect(w.text()).toContain('模型1'))
    await w.findAll('.actions button').find((b) => b.text() === '测试连接')!.trigger('click')
    await vi.waitFor(() => expect(api.modelsTest).toHaveBeenCalled())
    expect(w.find('.test-msg.ok').text()).toContain('连接成功')
  })

  it('删除：调用删除接口并刷新列表', async () => {
    const api = installApi()
    const w = mountPage()
    await vi.waitFor(() => expect(w.findAll('.model-item').length).toBe(2))
    await w.findAll('.actions button').find((b) => b.text() === '删除')!.trigger('click')
    await vi.waitFor(() => expect(api.modelsDelete).toHaveBeenCalled())
  })

  it('自定义模板却填官方地址：给出改用厂商模板的提示', async () => {
    store = [makeView(1, { provider: 'custom', base_url: 'https://api.deepseek.com/v1' })]
    installApi()
    const w = mountPage()
    await vi.waitFor(() => expect(w.find('.f-hint').exists()).toBe(true))
    expect(w.find('.f-hint').text()).toContain('DeepSeek')
  })

  it('自定义模板 + 中转站地址：不显示厂商提示', async () => {
    store = [makeView(1, { provider: 'custom', base_url: 'https://relay.example.com/v1' })]
    installApi()
    const w = mountPage()
    await vi.waitFor(() => expect(w.text()).toContain('模型1'))
    expect(w.find('.f-hint').exists()).toBe(false)
  })

  it('空数据时展示空态并自动打开新表单', async () => {
    store = []
    installApi()
    const w = mountPage()
    await vi.waitFor(() => expect(w.text()).toContain('还没有配置'))
    expect(w.find('.m-card').text()).toContain('新建模型配置')
  })
})
