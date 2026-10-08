// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import SideNav from '../../src/renderer/components/SideNav.vue'

// Vitest 默认不注入组件 CSS，直接读取 SFC 源码中的 style 块做断言
const styleBlock = readFileSync('src/renderer/components/SideNav.vue', 'utf8').match(
  /<style[^>]*>([\s\S]*?)<\/style>/
)![1]

// 应用全局样式，用于真实级联校验
const baseCss = readFileSync('src/renderer/styles/base.css', 'utf8')

function mountNav(attachToBody = false) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', component: { template: '<div/>' } },
      { path: '/mode', component: { template: '<div/>' } },
      { path: '/phrases', component: { template: '<div/>' } },
      { path: '/quota', component: { template: '<div/>' } },
      { path: '/config', component: { template: '<div/>' } },
      { path: '/about', component: { template: '<div/>' } }
    ]
  })
  return mount(SideNav, {
    global: { plugins: [pinia, router] },
    // getComputedStyle 只对文档树内的元素生效
    ...(attachToBody ? { attachTo: document.body } : {})
  })
}

describe('SideNav 侧边导航', () => {
  beforeEach(() => vi.useRealTimers())

  it('渲染 6 个导航项，文字为 主页/模式/常用语/AI 额度/模型配置/关于软件', () => {
    const w = mountNav()
    const items = w.findAll('a.nav-item')
    expect(items).toHaveLength(6)
    expect(items.map((i) => i.text().trim())).toEqual([
      '主页',
      '模式',
      '常用语',
      'AI 额度',
      '模型配置',
      '关于软件'
    ])
    expect(items[2].attributes('href')).toContain('/phrases')
  })

  it('导航文字无下划线（基础态与 hover/focus/active 态都显式去除）', () => {
    // 基础态
    expect(styleBlock).toMatch(/\.nav-item\s*\{[^}]*text-decoration:\s*none/)
    // 交互态规则块同样包含 none
    const interactive = styleBlock.match(/\.nav-item:hover[\s\S]*?\}/)
    expect(interactive).not.toBeNull()
    expect(interactive![0]).toContain('text-decoration: none')
  })

  it('导航字号增大到 15px', () => {
    expect(styleBlock).toMatch(/\.nav-item\s*\{[^}]*font-size:\s*15px/)
  })

  it('全局兜底样式同样去掉 <a> 下划线（避免任何一处遗漏）', () => {
    expect(baseCss).toMatch(/a,[\s\S]*?\{[^}]*text-decoration:\s*none/)
    expect(baseCss).toContain('a:visited')
  })

  it('级联计算后导航项的 text-decoration 恒为 none', () => {
    // 把应用真实样式（全局 base.css + 组件 scoped 样式）注入文档，
    // 用 getComputedStyle 校验最终计算值——这正是浏览器里决定有没有下划线的值。
    const style = document.createElement('style')
    style.textContent = `${baseCss}\n${styleBlock}`
    document.head.appendChild(style)
    try {
      const w = mountNav(true)
      for (const item of w.findAll('a.nav-item')) {
        const el = item.element as HTMLElement
        expect(window.getComputedStyle(el).textDecoration).toBe('none')
      }
      w.unmount()
    } finally {
      style.remove()
    }
  })
})
