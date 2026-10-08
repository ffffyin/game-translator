// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ResultView from '../../src/renderer/result/ResultView.vue'
import type { ResultData } from '../../src/shared/result'

const sample: ResultData = {
  directionLabel: '自动检测 → 中文（简体）',
  engine: 'local',
  pairs: [
    { id: 1, original: 'gg noob', translation: '打得不错，菜鸟' },
    { id: 2, original: 'rush B', translation: '快打 B' }
  ],
  styleOptions: [{ value: 'auto', label: '自动识别' }],
  currentStyle: 'auto',
  engineOptions: [
    { value: 'local', label: '本地 OCR' },
    { value: 'vision', label: 'AI 视觉' }
  ],
  currentEngine: 'local',
  canVision: false
}

function setup(): {
  wrapper: ReturnType<typeof mount>
  api: Record<string, ReturnType<typeof vi.fn>>
  push: (d: ResultData) => void
} {
  let push: (d: ResultData) => void = () => undefined
  const api: Record<string, ReturnType<typeof vi.fn>> = {
    onResultData: vi.fn((cb: (d: ResultData) => void) => {
      push = cb
    }),
    resultRetranslate: vi.fn().mockResolvedValue({ ok: true }),
    resultSetPinned: vi.fn(),
    resultClose: vi.fn(),
    resultCopy: vi.fn()
  }
  ;(window as unknown as { api: unknown }).api = api
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true
  })
  const wrapper = mount(ResultView)
  return { wrapper, api, push: (d) => push(d) }
}

describe('译文悬浮窗 ResultView', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'dark'
  })

  it('数据到达前显示加载提示', () => {
    const { wrapper } = setup()
    expect(wrapper.text()).toContain('翻译中')
    expect(wrapper.find('.spinner').exists()).toBe(true)
  })

  it('数据到达后渲染方向、通道徽章与全部原文/译文', async () => {
    const { wrapper, push } = setup()
    push(sample)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('自动检测 → 中文（简体）')
    expect(wrapper.text()).toContain('本地 OCR')
    expect(wrapper.text()).toContain('2 组文本')
    expect(wrapper.text()).toContain('gg noob')
    expect(wrapper.text()).toContain('打得不错，菜鸟')
    expect(wrapper.text()).toContain('快打 B')
  })

  it('视觉通道在模型不支持时禁用对应选项', async () => {
    const { wrapper, push } = setup()
    push(sample)
    await wrapper.vm.$nextTick()
    const visionOption = wrapper.findAll('option').find((o) => o.text() === 'AI 视觉')!
    expect(visionOption.attributes('disabled')).toBeDefined()
  })

  it('点击重新翻译携带当前通道与风格，成功后不显示错误', async () => {
    const { wrapper, api, push } = setup()
    push(sample)
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text().includes('重新翻译'))!.trigger('click')
    expect(api.resultRetranslate).toHaveBeenCalledWith({ engine: 'local', style: 'auto' })
    expect(wrapper.find('.err').exists()).toBe(false)
  })

  it('重新翻译失败时透出错误原因', async () => {
    const { wrapper, api, push } = setup()
    api.resultRetranslate.mockResolvedValue({ ok: false, error: '网络超时' })
    push(sample)
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text().includes('重新翻译'))!.trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.err').text()).toBe('网络超时')
  })

  it('复制译文拼接全部译文行写入剪贴板', async () => {
    const { wrapper, push } = setup()
    push(sample)
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text().includes('复制译文'))!.trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('打得不错，菜鸟\n快打 B')
  })

  it('置顶锁定切换时通知主进程', async () => {
    const { wrapper, api, push } = setup()
    push(sample)
    await wrapper.vm.$nextTick()
    const pinBtn = wrapper.findAll('.w-btn')[0]
    await pinBtn.trigger('click')
    expect(api.resultSetPinned).toHaveBeenCalledWith(true)
    await pinBtn.trigger('click')
    expect(api.resultSetPinned).toHaveBeenCalledWith(false)
  })

  it('组合模式降级时徽章说明实际用了 AI，并显示降级标记', async () => {
    const { wrapper, push } = setup()
    push({
      ...sample,
      engine: 'vision',
      degraded: true,
      engineOptions: [
        { value: 'local', label: '本地 OCR' },
        { value: 'vision', label: 'AI 视觉' },
        { value: 'hybrid', label: '本地 + AI' }
      ],
      canVision: true
    })
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('本地失败已降级')
    expect(wrapper.find('.degraded-tip').exists()).toBe(true)
    // 组合模式不因视觉不可用而禁用
    const hybrid = wrapper.findAll('option').find((o) => o.text() === '本地 + AI')!
    expect(hybrid.attributes('disabled')).toBeUndefined()
  })

  it('可选本地+AI 组合通道并原样下发', async () => {
    const { wrapper, api, push } = setup()
    push({
      ...sample,
      currentEngine: 'hybrid',
      engineOptions: [
        { value: 'local', label: '本地 OCR' },
        { value: 'hybrid', label: '本地 + AI' }
      ]
    })
    await wrapper.vm.$nextTick()
    const buttons = wrapper.findAll('button')
    await buttons.find((b) => b.text().includes('重新翻译'))!.trigger('click')
    expect(api.resultRetranslate).toHaveBeenCalledWith({ engine: 'hybrid', style: 'auto' })
  })

  it('点击关闭按钮通知主进程', async () => {
    const { wrapper, api, push } = setup()
    push(sample)
    await wrapper.vm.$nextTick()
    const closeBtn = wrapper.findAll('.w-btn')[1]
    await closeBtn.trigger('click')
    expect(api.resultClose).toHaveBeenCalled()
  })
})
