// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { nextTick } from 'vue'
import TitleBar from '../../src/renderer/components/TitleBar.vue'

const styleBlock = readFileSync('src/renderer/components/TitleBar.vue', 'utf8').match(
  /<style[^>]*>([\s\S]*?)<\/style>/
)![1]

function installApi(maximized = false) {
  let cb: ((v: boolean) => void) | null = null
  const api = {
    windowMinimize: vi.fn(),
    windowToggleMaximize: vi.fn(),
    windowClose: vi.fn(),
    windowIsMaximized: vi.fn(async () => maximized),
    onWindowMaximized: vi.fn((fn: (v: boolean) => void) => {
      cb = fn
      return () => {
        cb = null
      }
    })
  }
  ;(window as unknown as { api: typeof api }).api = api
  return { api, emitMaximized: (v: boolean) => cb?.(v) }
}

async function mountBar(maximized = false) {
  const handle = installApi(maximized)
  const w = mount(TitleBar)
  await nextTick()
  await nextTick()
  return { w, ...handle }
}

beforeEach(() => vi.restoreAllMocks())

describe('TitleBar 自绘标题栏', () => {
  it('显示应用名与三个窗口控制按钮', async () => {
    const { w } = await mountBar()
    expect(w.text()).toContain('游戏翻译助手')
    const btns = w.findAll('button.tb-btn')
    expect(btns).toHaveLength(3)
    expect(btns.map((b) => b.attributes('title'))).toEqual(['最小化', '最大化', '关闭'])
  })

  it('三个按钮分别调用最小化 / 最大化 / 关闭', async () => {
    const { w, api } = await mountBar()
    const btns = w.findAll('button.tb-btn')
    await btns[0].trigger('click')
    await btns[1].trigger('click')
    await btns[2].trigger('click')
    expect(api.windowMinimize).toHaveBeenCalledTimes(1)
    expect(api.windowToggleMaximize).toHaveBeenCalledTimes(1)
    expect(api.windowClose).toHaveBeenCalledTimes(1)
  })

  it('双击标题栏切换最大化', async () => {
    const { w, api } = await mountBar()
    await w.find('header.titlebar').trigger('dblclick')
    expect(api.windowToggleMaximize).toHaveBeenCalledTimes(1)
  })

  it('跟随最大化状态切换按钮图标与提示', async () => {
    const { w, emitMaximized } = await mountBar(false)
    const btn = () => w.findAll('button.tb-btn')[1]
    // 未最大化：单方框
    expect(btn().findAll('rect')).toHaveLength(1)
    expect(btn().attributes('title')).toBe('最大化')

    emitMaximized(true)
    await nextTick()
    expect(btn().attributes('title')).toBe('向下还原')
    expect(btn().html()).toContain('<path')
  })

  it('标题栏配色完全使用主题变量（跟随深色/浅色与强调色）', () => {
    expect(styleBlock).toMatch(/\.titlebar\s*\{[^}]*background:\s*var\(--side\)/)
    expect(styleBlock).toMatch(/\.titlebar\s*\{[^}]*border-bottom:\s*1px solid var\(--line\)/)
    expect(styleBlock).toMatch(/\.tb-logo\s*\{[^}]*background:\s*var\(--accent\)/)
    // 没有写死的颜色（除关闭按钮 hover 的白色文字）
    const hardColors = styleBlock.match(/#[0-9a-fA-F]{3,8}/g) ?? []
    expect(hardColors).toEqual(['#161a21', '#ffffff'])
  })

  it('标题栏可拖动，控制按钮不可拖动', () => {
    expect(styleBlock).toMatch(/\.titlebar\s*\{[^}]*app-region:\s*drag/)
    expect(styleBlock).toMatch(/\.tb-actions\s*\{[^}]*app-region:\s*no-drag/)
  })
})
