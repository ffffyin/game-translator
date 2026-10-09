// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import CloudApiSyncCard from '../../src/renderer/components/account/CloudApiSyncCard.vue'
import { installAccountApi, signedIn, type InstalledAccountApi } from './helpers/account-api'

const mounted: VueWrapper[] = []

/** card + 同一份 window.api 桩（installAccountApi 会重建桩，必须成对返回） */
async function mountCard(): Promise<{ w: VueWrapper; api: InstalledAccountApi }> {
  const api = installAccountApi(signedIn())
  const w = mount(CloudApiSyncCard, {
    global: { plugins: [createPinia()] }
  })
  mounted.push(w)
  // 卡内会触发 settings.load()，等本机设置落位再断言
  await vi.waitFor(() => expect(w.find('.sw').attributes('aria-checked')).toBe('false'))
  return { w, api }
}

async function enabled(w: VueWrapper): Promise<void> {
  await w.find('.ack input').setValue(true)
  await w.find('.sw').trigger('click')
  await vi.waitFor(() => expect(w.find('.mask').exists()).toBe(true))
  await w.findAll('.dlg-b button').find((b) => b.text() === '确认开启')!.trigger('click')
  await vi.waitFor(() => expect(w.find('.sw').attributes('aria-checked')).toBe('true'))
}

beforeEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
})

describe('CloudApiSyncCard 云端 API 配置开关', () => {
  it('默认关闭', async () => {
    const { w } = await mountCard()
    expect(w.find('.sw').attributes('aria-checked')).toBe('false')
    expect(w.text()).toContain('当前：已关闭')
  })

  it('未勾选免责声明时开关禁用，点了也打不开', async () => {
    const { w, api } = await mountCard()

    expect(w.find('.sw').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('请先阅读并确认风险')

    await w.find('.sw').trigger('click')
    await vi.waitFor(() => expect(w.find('.mask').exists()).toBe(false))
    expect(api.settingsSet).not.toHaveBeenCalled()
  })

  it('勾选免责声明后开关可用，但仍要过一次二次确认才真正开启', async () => {
    const { w, api } = await mountCard()

    await w.find('.ack input').setValue(true)
    expect(w.find('.sw').attributes('disabled')).toBeUndefined()

    await w.find('.sw').trigger('click')
    await vi.waitFor(() => expect(w.find('.mask').exists()).toBe(true))
    // 只弹窗，还没落库
    expect(api.settingsSet).not.toHaveBeenCalled()

    await w.findAll('.dlg-b button').find((b) => b.text() === '确认开启')!.trigger('click')
    await vi.waitFor(() => expect(api.settingsSet).toHaveBeenCalledWith('cloudSyncApi', 1))
    await vi.waitFor(() => expect(w.find('.sw').attributes('aria-checked')).toBe('true'))
    expect(w.text()).toContain('当前：已开启')
  })

  it('取消二次确认不会写入任何设置', async () => {
    const { w, api } = await mountCard()

    await w.find('.ack input').setValue(true)
    await w.find('.sw').trigger('click')
    await vi.waitFor(() => expect(w.find('.mask').exists()).toBe(true))
    await w.findAll('.dlg-b button').find((b) => b.text() === '取消')!.trigger('click')

    await vi.waitFor(() => expect(w.find('.mask').exists()).toBe(false))
    expect(api.settingsSet).not.toHaveBeenCalled()
  })

  it('免责声明文案逐字采用：风险标题 + 正文 + 三条风险条目 + 建议', async () => {
    const { w } = await mountCard()
    const text = w.find('.risk').text()

    expect(text).toContain('把 API 配置保存到云端的风险')
    expect(text).toContain(
      '开启后，你的 API 地址、模型名称与 API 密钥明文 会随配置一起上传到云端账号，用于在其他电脑上自动恢复。'
    )
    expect(text).toContain(
      '· 密钥一旦离开本机，就不再只受你一个人控制：账号密码泄露、云端服务方发生安全事件，都可能导致密钥被他人使用。'
    )
    expect(text).toContain(
      '· 由此产生的额度盗刷、费用损失、第三方服务异常或账号封禁，需由你自行承担，本软件不承担责任。'
    )
    expect(text).toContain('· 我们仍会使用加密通道传输，但无法承诺云端绝对安全。')
    expect(text).toContain('建议：只在你确实需要多台电脑同步时开启，并定期更换密钥。')
    expect(w.find('.ack').text()).toContain(
      '我已阅读并理解上述风险，同意将 API 配置（含密钥明文）保存到云端'
    )
  })

  it('关闭时提示云端密钥不会自动删除，并指向「删除云端配置」', async () => {
    const { w, api } = await mountCard()

    await enabled(w)

    await w.find('.sw').trigger('click')
    await vi.waitFor(() => expect(api.settingsSet).toHaveBeenCalledWith('cloudSyncApi', 0))
    await vi.waitFor(() => expect(w.find('.sw').attributes('aria-checked')).toBe('false'))
    expect(w.text()).toContain('云端已保存的密钥不会自动删除')
    expect(w.text()).toContain('删除云端配置')
  })
})
