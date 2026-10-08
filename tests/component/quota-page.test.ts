// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import QuotaPage from '../../src/renderer/pages/QuotaPage.vue'
import type { UsageDay } from '../../src/shared/api-contract'

function dayKey(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

let days: UsageDay[] = []

function installApi() {
  const api = {
    modelsList: vi.fn(async () => [
      {
        id: 1,
        name: 'deepseek',
        provider: 'custom',
        base_url: 'https://api.deepseek.com/v1',
        text_model: 'deepseek-chat',
        vision_enabled: 0,
        vision_model: null,
        params_json: null,
        is_default: 1,
        hasKey: true,
        created_at: '',
        updated_at: ''
      }
    ]),
    quotaQueryAll: vi.fn(async () => []),
    quotaQuery: vi.fn(async () => ({ configId: 1, supported: true, checkedAt: '' })),
    usageTotals: vi.fn(async () => ({ count: 26, chars: 8971, tokens_in: 20000, tokens_out: 25913 })),
    usageTotalsToday: vi.fn(async () => ({ count: 1, chars: 12, tokens_in: 10, tokens_out: 8 })),
    usageByConfig: vi.fn(async () => [{ name: 'deepseek', count: 26, chars: 8971 }]),
    usageAggregateDays: vi.fn(async () => structuredClone(days))
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

async function mountPage() {
  const w = mount(QuotaPage)
  // onMounted 里并发拉了模型 / 额度 / 用量，等全部 promise 落地再断言
  await flushPromises()
  await nextTick()
  expect(w.findAll('.bar-col')).toHaveLength(7)
  return w
}

beforeEach(() => {
  days = [
    { day: dayKey(2), count: 6, chars: 300, tokens_in: 100, tokens_out: 80 },
    { day: dayKey(1), count: 10, chars: 900, tokens_in: 30000, tokens_out: 20000 },
    { day: dayKey(0), count: 4, chars: 120, tokens_in: 40, tokens_out: 30 }
  ]
})

describe('QuotaPage 近 7 天柱状图', () => {
  it('补齐 7 根柱子，悬停浮层给出当天次数 / 字符 / Tokens', async () => {
    installApi()
    const w = await mountPage()
    const cols = w.findAll('.bar-col')
    expect(cols).toHaveLength(7)

    // 最右一列是今天
    expect(cols[6].classes()).toContain('today')
    const todayTip = cols[6].find('.tt').text()
    expect(todayTip).toContain('今天')
    expect(todayTip).toContain('4 次')
    expect(todayTip).toContain('120 字符')
    expect(todayTip).toContain('70 tokens') // tokens_in + tokens_out

    // 昨天（倒数第二列）
    const yTip = cols[5].find('.tt').text()
    expect(yTip).toContain('10 次')
    expect(yTip).toContain('900 字符')
    expect(yTip).toContain('50,000 tokens')
  })

  it('柱高按用量归一化：峰值列满高，无记录列为 0', async () => {
    installApi()
    const w = await mountPage()
    const bars = w.findAll('.bar')
    // 默认按次数：昨天 10 次为峰值 → 100%
    expect(bars[5].attributes('style')).toContain('height: 100%')
    // 没有任何记录的日子高度为 0
    expect(bars[0].attributes('style')).toContain('height: 0%')
    expect(w.findAll('.bar-num')[0].text()).toBe('–')
    expect(w.find('.chart-foot').text()).toContain('10 次')
  })

  it('切换指标后柱高与峰值跟着换（Characters / Tokens）', async () => {
    installApi()
    const w = await mountPage()
    const tabs = w.findAll('.metric-tab')
    expect(tabs.map((t) => t.text())).toEqual(['次数', '字符', 'Tokens'])

    // 切到字符：昨天 900 字符为峰值
    await tabs[1].trigger('click')
    await nextTick()
    expect(w.find('.chart-title').text()).toContain('字符')
    expect(w.findAll('.bar')[5].attributes('style')).toContain('height: 100%')
    expect(w.find('.chart-foot').text()).toContain('900 字符')
    // 索引 4 = 两天前（offset 2），该天 300 字符
    expect(w.findAll('.bar-num')[4].text()).toBe('300')

    // 切到 Tokens：昨天 50,000 为峰值
    await tabs[2].trigger('click')
    await nextTick()
    expect(w.find('.chart-foot').text()).toContain('50,000 tokens')
  })

  it('最近 7 天都没有记录时给出空态提示', async () => {
    days = []
    installApi()
    const w = await mountPage()
    expect(w.find('.chart-empty').exists()).toBe(true)
    expect(w.find('.chart-foot').exists()).toBe(false)
  })

  it('今天的数据按本地日期取，不会串到昨天', async () => {
    // 只在「今天」有记录：柱必须在最右一列，且计数正确
    days = [{ day: dayKey(0), count: 3, chars: 30, tokens_in: 3, tokens_out: 3 }]
    installApi()
    const w = await mountPage()
    const bars = w.findAll('.bar')
    expect(bars[6].attributes('style')).toContain('height: 100%')
    expect(w.findAll('.bar-num')[6].text()).toBe('3')
    expect(w.findAll('.tt')[5].text()).toContain('0 次')
  })
})
