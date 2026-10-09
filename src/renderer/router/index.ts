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
 * 判定只看「本机有没有有效会话」（auth.signedIn），**不看网络** ——
 * 断网时主进程回传的仍是 signedIn=true + online=false，用户照常使用，只有云端读写被拦。
 * 反过来说，只有真的没有会话才会被送到 /auth。
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
