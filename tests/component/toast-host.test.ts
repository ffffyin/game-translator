// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ToastHost from '../../src/renderer/components/ToastHost.vue'
import type { NotifyPayload } from '../../src/shared/api-contract'

function setup(): {
  wrapper: ReturnType<typeof mount>
  push: (p: NotifyPayload) => void
} {
  let push: (p: NotifyPayload) => void = () => undefined
  ;(window as unknown as { api: unknown }).api = {
    onNotify: vi.fn((cb: (p: NotifyPayload) => void) => {
      push = cb
    })
  }
  const wrapper = mount(ToastHost)
  return { wrapper, push: (p) => push(p) }
}

describe('ToastHost 提示生命周期', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('任务结束后进行中提示必须消失', async () => {
    const { wrapper, push } = setup()
    push({ type: 'loading', message: '正在读取并翻译…' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('正在读取并翻译')

    push({ type: 'error', message: '未读取到文本，请确认光标在聊天输入框' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('正在读取并翻译')
    expect(wrapper.text()).toContain('未读取到文本')
  })

  it('info 提示同样结束进行中状态', async () => {
    const { wrapper, push } = setup()
    push({ type: 'loading', message: '正在读取并翻译…' })
    await wrapper.vm.$nextTick()
    push({ type: 'info', message: '当前焦点在本软件窗口' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.toast.loading').exists()).toBe(false)
    expect(wrapper.text()).toContain('当前焦点在本软件窗口')
  })

  it('ok 提示 2.8 秒后自动消失', async () => {
    const { wrapper, push } = setup()
    push({ type: 'ok', message: '已替换为译文' })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('已替换为译文')
    vi.advanceTimersByTime(2800)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('已替换为译文')
  })

  it('兜底：没有任何结束通知时，进行中提示 90 秒后也会自动消失', async () => {
    const { wrapper, push } = setup()
    push({ type: 'loading', message: '正在读取并翻译…' })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.toast.loading').exists()).toBe(true)
    vi.advanceTimersByTime(90_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.toast.loading').exists()).toBe(false)
  })

  it('进度刷新复用同一条进行中提示，不堆叠', async () => {
    const { wrapper, push } = setup()
    push({ type: 'loading', message: '正在翻译… 已等待 15 秒' })
    await wrapper.vm.$nextTick()
    push({ type: 'loading', message: '正在翻译… 已等待 30 秒' })
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.toast.loading')).toHaveLength(1)
    expect(wrapper.text()).toContain('已等待 30 秒')
    expect(wrapper.text()).not.toContain('已等待 15 秒')
  })

  it('进度刷新会重置兜底计时，长任务进行中不会突然消失', async () => {
    const { wrapper, push } = setup()
    push({ type: 'loading', message: '正在翻译… 已等待 15 秒' })
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(80_000)
    push({ type: 'loading', message: '正在翻译… 已等待 95 秒' })
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(80_000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.toast.loading').exists()).toBe(true)
  })

  it('卸载时清理定时器，不留悬挂回调', async () => {
    const { wrapper, push } = setup()
    push({ type: 'ok', message: '已替换为译文' })
    await wrapper.vm.$nextTick()
    wrapper.unmount()
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow()
  })
})
