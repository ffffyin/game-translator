import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/home' },
    { path: '/home', name: 'home', component: () => import('../pages/HomePage.vue') },
    { path: '/mode', name: 'mode', component: () => import('../pages/ModePage.vue') },
    { path: '/phrases', name: 'phrases', component: () => import('../pages/PhrasesPage.vue') },
    { path: '/quota', name: 'quota', component: () => import('../pages/QuotaPage.vue') },
    { path: '/config', name: 'config', component: () => import('../pages/ConfigPage.vue') },
    { path: '/account', name: 'account', component: () => import('../pages/AccountPage.vue') },
    { path: '/about', name: 'about', component: () => import('../pages/AboutPage.vue') }
  ]
})

export default router
