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

function mountNav() {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/home', component: { template: '<div/>' } },
      { path: '/mode', component: { template: '<div/>' } },
      { path: '/quota', component: { template: '<div/>' } },
      { path: '/config', component: { template: '<div/>' } },
      { path: '/about', component: { template: '<div/>' } }
    ]
  })
  return mount(SideNav, { global: { plugins: [pinia, router] } })
}

describe('SideNav 侧边导航', () => {
  beforeEach(() => vi.useRealTimers())

  it('渲染 5 个导航项，文字为 主页/模式/AI 额度/模型配置/关于软件', () => {
    const w = mountNav()
    const items = w.findAll('a.nav-item')
    expect(items).toHaveLength(5)
    expect(items.map((i) => i.text().trim())).toEqual([
      '主页',
      '模式',
      'AI 额度',
      '模型配置',
      '关于软件'
    ])
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
})
