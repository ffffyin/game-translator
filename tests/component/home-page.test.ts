// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { nextTick } from 'vue'
import HomePage from '../../src/renderer/pages/HomePage.vue'
import { createPinia, setActivePinia } from 'pinia'

function installApi() {
  const api = {
    termsListLibs: vi.fn(async () => [
      { id: 1, game: 'dota2', name: 'Dota2', version: '2026.10.08', is_builtin: 1, term_count: 71 }
    ]),
    hotkeysGetAll: vi.fn(async () => [
      { id: 1, action_code: 'translate_replace', accelerators: 'Ctrl+Alt+1', enabled: 1 },
      { id: 2, action_code: 'translate_clipboard', accelerators: 'Ctrl+Alt+2', enabled: 1 },
      { id: 3, action_code: 'capture_region', accelerators: 'Ctrl+Alt+3', enabled: 1 },
      { id: 4, action_code: 'capture_fullscreen', accelerators: 'Ctrl+Alt+4', enabled: 1 }
    ]),
    settingsGetAll: vi.fn(async () => ({})),
    settingsSet: vi.fn(async () => undefined),
    testTranslate: vi.fn(async (text: string) => ({
      ok: true,
      translation: '译文：' + text
    }))
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

function mountHomePage() {
  return mount(HomePage, { global: { plugins: [createPinia()] } })
}
beforeEach(() => {
  setActivePinia(createPinia())
})

describe('HomePage 主页', () => {
  it('渲染翻译设置四项与动态术语库选项', async () => {
    installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('Dota2'))
    expect(w.text()).toContain('源语言')
    expect(w.text()).toContain('目标语言')
    expect(w.text()).toContain('翻译风格')
  })

  it('渲染四个功能快捷键行', async () => {
    installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('Ctrl+Alt+4'))
    expect(w.findAll('.hk-row')).toHaveLength(4)
  })

  it('快捷键行按设计稿改版：图标 + 动作名 + 说明 + 右侧按键徽章', async () => {
    installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('Ctrl+Alt+4'))

    const rows = w.findAll('.hk-row')
    // 每行都有图标块
    for (const r of rows) {
      expect(r.find('.ic svg').exists()).toBe(true)
      expect(r.find('.mid .nm').text().length).toBeGreaterThan(0)
      expect(r.find('.mid .ds').text().length).toBeGreaterThan(0)
      expect(r.find('kbd').exists()).toBe(true)
    }

    expect(rows[0].find('.nm').text()).toBe('全选翻译并自动替换')
    expect(rows[0].find('.ds').text()).toBe('取当前窗口全部文字，译文直接替换原文')
    expect(rows[1].find('.nm').text()).toBe('全选翻译 · 进入剪贴板')
    expect(rows[1].find('.ds').text()).toBe('原文不动，译文复制到剪贴板')
    expect(rows[2].find('.nm').text()).toBe('截图区域翻译')
    expect(rows[3].find('.nm').text()).toBe('截图全屏翻译')
    expect(rows[3].find('kbd').text()).toBe('Ctrl+Alt+4')
    // 卡片标题文案与设计稿一致
    expect(w.text()).toContain('点击右侧按键即可修改，支持 Ctrl / Alt / Shift 组合键')
  })

  it('快捷键卡样式：列表卡片化 + 等宽键位徽章（设计稿 .hk-list/.kbd）', () => {
    const styleBlock = readFileSync('src/renderer/pages/HomePage.vue', 'utf8').match(
      /<style[^>]*>([\s\S]*?)<\/style>/
    )![1]
    expect(styleBlock).toMatch(/\.hk-list\s*\{[^}]*display:\s*grid/)
    expect(styleBlock).toMatch(/\.hk-row\s*\{[^}]*background:\s*var\(--card2\)/)
    expect(styleBlock).toMatch(/\.hk-row\s*\{[^}]*border-radius:\s*10px/)
    expect(styleBlock).toMatch(/\.hk-row \.ic\s*\{[^}]*background:\s*var\(--accent-soft\)/)
    expect(styleBlock).toMatch(/kbd\s*\{[^}]*font-family:\s*ui-monospace/)
    expect(styleBlock).toMatch(/kbd\s*\{[^}]*color:\s*var\(--accent\)/)
  })

  it('点击快捷键打开改键弹层，ESC/取消可关闭', async () => {
    installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('Ctrl+Alt+1'))
    await w.findAll('.hk-row kbd')[0].trigger('click')
    await nextTick()
    expect(w.text()).toContain('请按下新的组合键')
    await w.findAll('button').find((b) => b.text() === '取消')!.trigger('click')
    await nextTick()
    expect(w.text()).not.toContain('请按下新的组合键')
  })

  it('手动测试卡：空输入提示错误', async () => {
    installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('手动测试'))
    await w.findAll('button').find((b) => b.text().trim() === '翻译')!.trigger('click')
    expect(w.find('.test-error').text()).toContain('输入')
  })

  it('手动测试卡：输入后展示译文', async () => {
    const api = installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('手动测试'))
    const ta = w.find('textarea')
    ta.element.value = 'gg noob'
    await ta.trigger('input')
    await w.findAll('button').find((b) => b.text().trim() === '翻译')!.trigger('click')
    await vi.waitFor(() => expect(api.testTranslate).toHaveBeenCalledWith('gg noob'))
    expect(w.find('.test-result').text()).toContain('译文：gg noob')
  })

  it('外观：主题三按钮与强调色色块存在', async () => {
    installApi()
    const w = mountHomePage()
    await vi.waitFor(() => expect(w.text()).toContain('跟随系统'))
    expect(w.findAll('.seg-btn')).toHaveLength(3)
    expect(w.findAll('.sw').length).toBeGreaterThan(1)
  })
})
