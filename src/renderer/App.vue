<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TitleBar from './components/TitleBar.vue'
import SideNav from './components/SideNav.vue'
import ToastHost from './components/ToastHost.vue'
import { useSettingsStore } from './stores/settings'
import { useModelsStore } from './stores/models'
import { useAuthStore } from './stores/auth'

const settings = useSettingsStore()
const models = useModelsStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/** 启动加载中：此时登录态未知，监听器不应该抢在初始化完成前改路由 */
const booting = ref(true)

/**
 * 登录态与路由的唯一同步点。
 *
 * 放这里而不是散落到各表单，是为了保证「任何入口登出 → 回到 /auth」「任何入口登录 → 离开 /auth」
 * 都只有一条路径，不会互相打架。
 */
watch(
  () => auth.signedIn,
  async (signedIn) => {
    if (booting.value) return
    if (!signedIn) {
      if (route.path !== '/auth') await router.replace('/auth')
      return
    }
    if (route.path === '/auth') await router.replace('/home')
  }
)

async function syncRoute(): Promise<void> {
  if (!auth.signedIn) {
    if (route.path !== '/auth') await router.replace('/auth')
    return
  }
  if (route.path === '/auth') await router.replace('/home')
}

onMounted(async () => {
  try {
    await settings.load()
  } catch {
    // 本机设置读不到也要能进登录页，否则用户连软件都用不了
  }
  // 登录态是本地会话判定，断网也能拿到 signedIn=true
  await auth.refresh()
  booting.value = false
  await nextTick()
  await syncRoute()
  try {
    await models.refresh()
  } catch {
    // 模型列表失败不阻塞界面
  }
})
</script>

<template>
  <div class="app-root">
    <TitleBar />
    <div class="app-shell">
      <!-- 未登录不渲染侧边栏：登录后才有权进入任何功能页 -->
      <SideNav v-if="auth.signedIn" />
      <main class="content" :class="{ auth: !auth.signedIn }">
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>
    <ToastHost />
  </div>
</template>

<style scoped>
.app-root {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.app-shell {
  flex: 1;
  min-height: 0;
  display: flex;
}
.content {
  flex: 1;
  overflow-y: auto;
  padding: 26px 28px;
}
/* 登录页自带居中布局，这里交出全部空间 */
.content.auth {
  padding: 0;
  display: flex;
  flex-direction: column;
}
</style>
