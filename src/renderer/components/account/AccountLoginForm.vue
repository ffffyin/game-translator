<script setup lang="ts">
import { ref } from 'vue'
import PasswordField from './PasswordField.vue'
import { validateEmail, validatePassword } from '../../../shared/account'
import { friendlyError, friendlyOk } from '../../utils/message'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'

/**
 * 登录表单：**登录标识是邮箱**，密码用户自设。
 * 「昵称」只在注册时收一次，作为纯展示字段，不参与登录。
 */
const props = withDefaults(
  defineProps<{
    /** 「记住邮箱」预填值 */
    rememberedEmail?: string
    /** 「记住邮箱」初始勾选态 */
    initialRemember?: boolean
    /** 是否显示「注册 / 忘记密码」入口（AuthPage 自带分段切换，不需要） */
    showLinks?: boolean
  }>(),
  { rememberedEmail: '', initialRemember: true, showLinks: true }
)

const emit = defineEmits<{
  success: []
  'go-register': []
  'go-reset': []
}>()

const auth = useAuthStore()
const settings = useSettingsStore()

const email = ref(props.rememberedEmail)
const password = ref('')
const remember = ref(props.initialRemember)
const busy = ref(false)
const msg = ref<{ ok: boolean; text: string } | null>(null)

function setMsg(ok: boolean, text: string): void {
  msg.value = { ok, text }
}

/** 「记住邮箱」只影响登录框预填，主进程据此写本机设置。失败不影响登录结果 */
async function persistRemember(mail: string): Promise<void> {
  try {
    await settings.update('cloudAccountEmail', remember.value ? mail : '')
    await settings.update('cloudRememberAccount', remember.value ? 1 : 0)
  } catch {
    // 记住账号是便利功能，写不进去不该让登录失败
  }
}

async function submit(): Promise<void> {
  if (busy.value) return

  const mail = email.value.trim()
  const mailCheck = validateEmail(mail)
  if (!mailCheck.ok) {
    setMsg(false, mailCheck.message)
    return
  }
  const pwdCheck = validatePassword(password.value)
  if (!pwdCheck.ok) {
    setMsg(false, pwdCheck.message)
    return
  }

  busy.value = true
  setMsg(true, '正在登录…')
  try {
    const r = await window.api.cloudSignIn({ email: mail, password: password.value, remember: remember.value })
    auth.applyStatus(r.status)
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    password.value = ''
    await persistRemember(mail)
    setMsg(true, friendlyOk(r.message, '登录成功'))
    emit('success')
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="login" @submit.prevent="submit">
    <div class="f-row">
      <label>邮箱</label>
      <input v-model="email" class="m-input" placeholder="you@example.com" autocomplete="username" />
    </div>

    <div class="f-row">
      <label>密码</label>
      <PasswordField
        v-model="password"
        input-id="login-password"
        placeholder="登录密码"
        autocomplete="current-password"
        @enter="submit"
      />
    </div>

    <label class="remember">
      <input v-model="remember" type="checkbox" />
      记住邮箱
    </label>

    <div v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'error'">{{ msg.text }}</div>

    <button class="m-btn accent submit" type="submit" :disabled="busy">
      {{ busy ? '登录中…' : '登录' }}
    </button>

    <div v-if="showLinks" class="links">
      <button type="button" class="link" @click="emit('go-register')">注册新账号</button>
      <span class="sep">·</span>
      <button type="button" class="link" @click="emit('go-reset')">忘记密码</button>
    </div>
  </form>
</template>

<style scoped>
.f-row {
  display: grid;
  grid-template-columns: 62px 1fr;
  align-items: start;
  gap: 10px;
  margin-bottom: 12px;
}
.f-row label {
  font-size: 12.5px;
  color: var(--txt2);
  line-height: 36px;
}
.remember {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--txt2);
  margin: 2px 0 14px;
  cursor: pointer;
}
.remember input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}
.msg {
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--card2);
  border: 1px solid var(--line);
  margin-bottom: 12px;
}
.msg.ok {
  color: var(--teal);
  border-color: var(--teal);
}
.msg.error {
  color: var(--danger);
  border-color: var(--danger);
}
.submit {
  width: 100%;
  padding: 10px 15px;
}
.submit:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.links {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 14px;
  font-size: 12px;
}
.link {
  border: none;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  padding: 0;
}
.link:hover {
  text-decoration: underline;
}
.sep {
  color: var(--txt3);
}
</style>
