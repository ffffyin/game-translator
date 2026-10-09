<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AccountLoginForm from '../components/account/AccountLoginForm.vue'
import AccountRegisterForm from '../components/account/AccountRegisterForm.vue'
import AccountResetForm from '../components/account/AccountResetForm.vue'
import { useAuthStore } from '../stores/auth'
import { useSettingsStore } from '../stores/settings'

/**
 * 登录门页面：**不登录不允许使用软件**，所以这里没有侧边栏、没有返回入口，
 * 只有一张卡切换「登录 / 注册 / 找回密码」。
 */
type Mode = 'login' | 'register' | 'reset'

const auth = useAuthStore()
const settings = useSettingsStore()
const router = useRouter()

const mode = ref<Mode>('login')
const email = ref('')
/** 来自子组件的跨标签提示（如「密码已重置，请用新密码登录」）：写在这里才不会被组件卸载带走 */
const notice = ref<{ ok: boolean; text: string } | null>(null)

const TABS: Array<{ key: Mode; label: string }> = [
  { key: 'login', label: '登录' },
  { key: 'register', label: '注册' },
  { key: 'reset', label: '找回密码' }
]

const rememberedEmail = computed<string>(() => settings.settings.cloudAccountEmail ?? '')
const initialRemember = computed<boolean>(() => settings.settings.cloudRememberAccount !== 0)

function toMode(next: Mode): void {
  notice.value = null
  mode.value = next
}

/** 重置成功但没自动登进去：带着提示回到登录页，用户不必回想刚才发生了什么 */
function backToLogin(message?: string): void {
  notice.value = message ? { ok: true, text: message } : null
  mode.value = 'login'
}

async function enterApp(): Promise<void> {
  await router.replace('/home')
}

/** 账号服务没起来时给一条自救路径，别只丢一个红字让用户干瞪眼 */
const retrying = ref(false)
async function retryStatus(): Promise<void> {
  if (retrying.value) return
  retrying.value = true
  try {
    await auth.refresh()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <div class="card m-card">
      <div class="brand">
        <span class="lg">译</span>
        <div>
          <h2>游戏翻译助手</h2>
          <p>登录后即可开始使用</p>
        </div>
      </div>

      <div v-if="!auth.available" class="banner banner-action">
        <span>账号服务没能启动，通常是网络不通或安全组件被拦。</span>
        <button type="button" class="retry" :disabled="retrying" @click="retryStatus">
          {{ retrying ? '重试中…' : '重试' }}
        </button>
      </div>
      <p v-else-if="!auth.online" class="banner">
        网络暂时不可用。若本机已保存登录状态，仍可继续操作，只是云端同步会暂停。
      </p>

      <div class="tabs">
        <button
          v-for="t in TABS"
          :key="t.key"
          type="button"
          class="tab"
          :class="{ on: mode === t.key }"
          @click="toMode(t.key)"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- ⚠️ v-if / v-else-if / v-else 必须首尾相接，中间不许插任何元素。
           之前 notice 那行夹在中间，把 v-if 链切断，导致 v-else 变成独立的
           「其他情况」，注册表单和重置表单会同时渲染出来。 -->
      <AccountLoginForm
        v-if="mode === 'login'"
        :remembered-email="rememberedEmail"
        :initial-remember="initialRemember"
        :show-links="false"
        @success="enterApp"
        @go-register="toMode('register')"
        @go-reset="toMode('reset')"
      />
      <AccountRegisterForm
        v-else-if="mode === 'register'"
        :initial-email="email"
        :show-links="false"
        @success="enterApp"
        @go-login="toMode('login')"
      />
      <AccountResetForm
        v-else
        :initial-email="email"
        :show-links="false"
        @signed-in="enterApp"
        @done="backToLogin"
        @go-login="toMode('login')"
      />

      <p v-if="notice" class="banner ok">{{ notice.text }}</p>

      <p class="foot">登录标识是邮箱，昵称仅用于展示，不参与登录。</p>
    </div>
  </div>
</template>

<style scoped>
.auth-page {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow-y: auto;
}
.card {
  width: 420px;
  max-width: 100%;
  padding: 26px 26px 22px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 18px;
}
.lg {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--accent);
  color: #161a21;
  font-weight: 900;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.brand h2 {
  font-size: 17px;
  font-weight: 700;
}
.brand p {
  font-size: 12px;
  color: var(--txt3);
}
.banner {
  font-size: 12px;
  line-height: 1.7;
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 14px;
}
.banner.ok {
  color: var(--teal);
  background: var(--teal-soft);
  border-color: var(--teal);
}
.banner-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.retry {
  flex-shrink: 0;
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  font-size: 12px;
  font-family: inherit;
  padding: 4px 12px;
  border-radius: 6px;
  cursor: pointer;
}
.retry:disabled {
  opacity: 0.55;
  cursor: default;
}
.tabs {
  display: flex;
  gap: 4px;
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 3px;
  margin-bottom: 18px;
}
.tab {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--txt2);
  font-size: 12.5px;
  padding: 7px 4px;
  border-radius: 6px;
  cursor: pointer;
  font-family: inherit;
}
.tab.on {
  background: var(--accent);
  color: #161a21;
  font-weight: 600;
}
.foot {
  margin-top: 16px;
  font-size: 11.5px;
  color: var(--txt3);
  text-align: center;
}
</style>
