// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import App from '../../src/renderer/App.vue'
import { authGuard } from '../../src/renderer/router'
import { useAuthStore } from '../../src/renderer/stores/auth'
import {
  installAccountApi,
  signedIn,
  signedOut,
  type InstalledAccountApi
} from './helpers/account-api'

/** 各功能页用桩组件顶替：登录门只关心路由走向，不关心页面内容 */
function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/home' },
      { path: '/auth', name: 'auth', component: { template: '<div class="p">登录页</div>' } },
      { path: '/home', name: 'home', component: { template: '<div class="p">主页</div>' } },
      { path: '/config', name: 'config', component: { template: '<div class="p">模型配置</div>' } }
    ]
  })
  // 生产守卫直接挂上来，测的就是线上那份判定逻辑本身
  router.beforeEach(authGuard)
  return router
}

function boot(pinia: ReturnType<typeof createPinia>): ReturnType<typeof createPinia> {
  setActivePinia(pinia)
  return pinia
}

const mounted: VueWrapper[] = []

function mountApp(pinia: ReturnType<typeof createPinia>, router: ReturnType<typeof makeRouter>) {
  const w = mount(App, { global: { plugins: [pinia, router] } })
  mounted.push(w)
  return w
}

beforeEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
})

describe('登录门路由守卫 authGuard', () => {
  it('未登录访问 /home 被重定向到 /auth', async () => {
    installAccountApi(signedOut())
    boot(createPinia())
    await useAuthStore().refresh()
    const router = makeRouter()

    await router.push('/home')
    expect(router.currentRoute.value.path).toBe('/auth')
  })

  it('登录态还没读到之前一律放行，避免开局误杀', async () => {
    installAccountApi(signedOut())
    boot(createPinia())
    // 刻意不 refresh：ready 仍为 false
    const router = makeRouter()

    await router.push('/home')
    expect(router.currentRoute.value.path).toBe('/home')
  })

  it('已登录访问 /auth 被送回 /home', async () => {
    installAccountApi(signedIn())
    boot(createPinia())
    await useAuthStore().refresh()
    const router = makeRouter()

    await router.push('/auth')
    expect(router.currentRoute.value.path).toBe('/home')
  })

  it('未登录访问任意业务路由都落到 /auth', async () => {
    installAccountApi(signedOut())
    boot(createPinia())
    await useAuthStore().refresh()
    const router = makeRouter()

    await router.push('/config')
    expect(router.currentRoute.value.path).toBe('/auth')
  })
})

describe('App.vue 登录门', () => {
  it('未登录时不渲染侧边栏，并把页面停在 /auth', async () => {
    installAccountApi(signedOut())
    const pinia = boot(createPinia())
    const router = makeRouter()

    const w = mountApp(pinia, router)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/auth'))

    expect(w.find('aside.side').exists()).toBe(false)
    expect(w.findAll('a.nav-item')).toHaveLength(0)
    // 标题栏必须保留：用户还要能关窗口
    expect(w.find('header.titlebar').exists()).toBe(true)
  })

  it('已登录时渲染侧边栏并停在 /home', async () => {
    installAccountApi(signedIn())
    const pinia = boot(createPinia())
    const router = makeRouter()

    const w = mountApp(pinia, router)
    await vi.waitFor(() => expect(w.find('aside.side').exists()).toBe(true))

    expect(router.currentRoute.value.path).toBe('/home')
    expect(w.findAll('a.nav-item')).toHaveLength(7)
  })

  it('离线但本机已有会话：照常使用，不被踢下线', async () => {
    installAccountApi(signedIn({ online: false, message: '网络不可用' }))
    const pinia = boot(createPinia())
    const router = makeRouter()

    const w = mountApp(pinia, router)
    await vi.waitFor(() => expect(w.find('aside.side').exists()).toBe(true))
    expect(router.currentRoute.value.path).toBe('/home')
  })

  it('登出后立即回到 /auth 并撤掉侧边栏', async () => {
    installAccountApi(signedIn())
    const pinia = boot(createPinia())
    const router = makeRouter()

    const w = mountApp(pinia, router)
    await vi.waitFor(() => expect(w.find('aside.side').exists()).toBe(true))

    // 模拟退出登录：之后 cloudStatus 返回未登录
    window.api.cloudStatus = async () => signedOut()
    await useAuthStore().refresh()

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/auth'))
    expect(w.find('aside.side').exists()).toBe(false)
  })
})
