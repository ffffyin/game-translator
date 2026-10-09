import { createRouter, createWebHashHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/auth', name: 'auth', component: () => import('../pages/AuthPage.vue') },
    { path: '/home', name: 'home', component: () => import('../pages/HomePage.vue') },
    { path: '/mode', name: 'mode', component: () => import('../pages/ModePage.vue') },
    { path: '/phrases', name: 'phrases', component: () => import('../pages/PhrasesPage.vue') },
    { path: '/quota', name: 'quota', component: () => import('../pages/QuotaPage.vue') },
    { path: '/config', name: 'config', component: () => import('../pages/ConfigPage.vue') },
    { path: '/account', name: 'account', component: () => import('../pages/AccountPage.vue') },
    { path: '/about', name: 'about', component: () => import('../pages/AboutPage.vue') }
  ]
})

/**
 * 登录门：不登录不允许使用软件。
 *
 * 判定只看 auth.signedIn —— 而主进程只有在「本次启动真的通过云端验证过」时才会给出
 * signedIn=true（手动登录 / 注册 / 自动登录成功都算）。这意味着：
 *  - **每次启动都需要重新登录**，除非开了「自动登录」且本次自动登录成功；
 *  - **离线打不开软件**：没通过云端验证就没有会话，一律停在 /auth。
 * 唯一会看到 signedIn=true + online=false 的情形，是本次已经登录成功后中途掉线
 * （人刚验过身份，不该被一次网络抖动挡在门外）。
 */
export function authGuard(to: RouteLocationNormalized): boolean | { path: string } {
  const auth = useAuthStore()
  // status 还没回来之前一律放行：开局误杀到登录页，再跳回来反而更像是故障
  if (!auth.ready) return true
  if (!auth.signedIn) return to.path === '/auth' ? true : { path: '/auth' }
  return to.path === '/auth' ? { path: '/home' } : true
}

router.beforeEach(authGuard)

export default router
