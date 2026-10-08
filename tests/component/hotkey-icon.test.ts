// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import HotkeyIcon from '../../src/renderer/components/HotkeyIcon.vue'
import { FUNCTION_ACTIONS } from '../../src/shared/hotkeys'

// 设计稿 4.1 的四个图标路径
const DESIGN_ICONS: Record<string, string[]> = {
  translate_replace: ['M4 8h13l-4-4M20 16H7l4 4'],
  translate_clipboard: ['M9 4a3 3 0 016 0M9 11h6M9 15h4'],
  capture_region: ['M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14'],
  capture_fullscreen: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5']
}

describe('HotkeyIcon 快捷键图标', () => {
  it('四个功能动作都能渲染出对应的描边图标', () => {
    for (const code of Object.keys(DESIGN_ICONS)) {
      const w = mount(HotkeyIcon, { props: { code } })
      expect(w.find('svg').exists()).toBe(true)
      for (const d of DESIGN_ICONS[code]) expect(w.html()).toContain(d)
    }
  })

  it('图标颜色取 currentColor，由外层 .ic 控制（跟随主题强调色）', () => {
    const html = mount(HotkeyIcon, { props: { code: 'capture_region' } }).html()
    expect(html).toContain('stroke="currentColor"')
    expect(html).toContain('fill="none"')
  })

  it('未知动作码有兜底图形，不会渲染空白', () => {
    const w = mount(HotkeyIcon, { props: { code: 'phrase_1' } })
    expect(w.find('svg circle').exists()).toBe(true)
  })

  it('每个功能动作都有说明文案（界面第二行小字）', () => {
    for (const a of FUNCTION_ACTIONS) {
      expect(a.desc).toBeTruthy()
    }
  })
})
