<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import TitleBar from './components/TitleBar.vue'
import SideNav from './components/SideNav.vue'
import ToastHost from './components/ToastHost.vue'
import UpdatePromptDialog from './components/UpdatePromptDialog.vue'
import { shouldPromptBootUpdate, type UpdateInfo } from '../shared/update'
import { useSettingsStore } from './stores/settings'
import { useModelsStore } from './stores/models'
import { useAuthStore } from './stores/auth'

const settings = useSettingsStore()
const models = useModelsStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

/** 启动期 login 态未知，监听器不应该抢在初始化完成前改路由 */
const booting = ref(true)

/** 启动自动检查到新版本时要弹的版本信息；null 表示不弹 */
const updatePrompt = ref<UpdateInfo | null>(null)

/**
 * 启动时的自动更新检查（fire-and-forget）。
 *
 * 两个刻意的选择：
 * 1. **排在登录之后**：每次启动都要重新登录，更新检查绝不能抢在它前面拖慢进界面；
 * 2. **失败完全静默**：用户这会儿什么都没点，网络断了/清单坏了就当没发生过，
 *    只写日志。想看结果的人会自己去「关于软件」页点「检查软件更新」。
 */
async function checkUpdateOnBoot(): Promise<void> {
  try {
    const r = await window.api.checkUpdate()
    if (!shouldPromptBootUpdate(r, settings.settings.updateSkipVersion)) return
    updatePrompt.value = r.info ?? null
  } catch (e) {
    console.warn('[update] 启动自动检查失败：', e)
  }
}

async function goUpdate(url: string): Promise<void> {
  updatePrompt.value = null
  try {
    await window.api.openDownload(url)
  } catch (e) {
    console.warn('[update] 打开下载地址失败：', e)
  }
}

async function skipUpdate(version: string): Promise<void> {
  updatePrompt.value = null
  try {
    await settings.update('updateSkipVersion', version)
  } catch (e) {
    // 写不进去也不该把用户卡在弹窗里：最坏结果是下次照常提醒一次
    console.warn('[update] 记录跳过版本失败：', e)
  }
}

function laterUpdate(): void {
  // 「下次再说」刻意不落任何数据：下次启动必须照常提醒
  updatePrompt.value = null
}

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
  // 启动门控：必须在 refresh 之前。
  //  - 没开「自动登录」→ 清掉本机会话，返回未登录（每次打开都要重新登录）；
  //  - 开了 → 用保存的邮箱 + 密码走一次真实联网登录，成功才返回已登录。
  // 这一趟要联网，断网时可能慢，但它决定的是「这一趟能不能直接进软件」，不能省。
  await auth.prepareBoot()
  await auth.refresh()
  booting.value = false
  await nextTick()
  await syncRoute()
  try {
    await models.refresh()
  } catch {
    // 模型列表失败不阻塞界面
  }
  // 登录进主界面之后才检查更新，且不等它返回。
  // 未登录时停在登录页，那个界面已经够挤了，不该再叠一层弹窗。
  if (auth.signedIn) void checkUpdateOnBoot()
})
</script>

<template>
  <div class="app-root">
    <TitleBar />
    <div class="app-shell">
      <!-- 未登录不渲染侧边栏：登录后才有权进入任何功能页 -->
      <SideNav v-if="auth.signedIn && !booting" />
      <main class="content" :class="{ auth: !auth.signedIn }">
        <!-- 启动期登录态未知，先给一个明确的加载态。
             没有它的话，cloudStatus 握手慢（断网时要等超时）会先显示几秒纯背景，
             看起来跟黑屏/卡死一模一样。 -->
        <div v-if="booting" class="booting">
          <div class="booting-bar"><i /></div>
          <p class="booting-text">正在检查登录状态…</p>
          <p class="booting-hint">首次使用或长时间未登录时，可能需要几秒钟</p>
        </div>
        <router-view v-else v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </main>
    </div>
    <ToastHost />
    <UpdatePromptDialog
      v-if="updatePrompt"
      :info="updatePrompt"
      @update="goUpdate"
      @skip="skipUpdate"
      @later="laterUpdate"
    />
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
.booting {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
}
.booting-bar {
  width: 180px;
  height: 4px;
  border-radius: 999px;
  background: var(--card2);
  overflow: hidden;
}
.booting-bar i {
  display: block;
  width: 40%;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  animation: booting-slide 1.1s ease-in-out infinite;
}
@keyframes booting-slide {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(250%);
  }
}
.booting-text {
  margin: 0;
  color: var(--txt2);
  font-size: 13px;
}
.booting-hint {
  margin: 0;
  color: var(--txt3);
  font-size: 12px;
}
</style>
