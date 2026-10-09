<script setup lang="ts">
import { ref, watch } from 'vue'
import PasswordField from './PasswordField.vue'
import { validateEmail, validatePassword } from '../../../shared/account'
import { friendlyError, friendlyOk } from '../../utils/message'
import { useAuthStore } from '../../stores/auth'
import { useSettingsStore } from '../../stores/settings'

/**
 * 登录表单：**登录标识是邮箱**，密码用户自设。
 * 「昵称」只在注册时收一次，作为纯展示字段，不参与登录。
 *
 * 三个勾选框的分工（默认值：记住邮箱=开、保存密码=关、自动登录=关）：
 *  - 记住邮箱：下次打开登录页自动填邮箱；
 *  - 保存密码：把密码用 DPAPI 加密存本机，下次自动填进密码框；
 *  - 自动登录：启动时直接用保存的邮箱 + 密码完成一次真实联网登录。
 *
 * 联动规则来自「没有密码就没法自动登录」这一条硬约束，见下方 watch。
 */
const props = withDefaults(
  defineProps<{
    /** 「记住邮箱」预填值 */
    rememberedEmail?: string
    /** 「记住邮箱」初始勾选态 */
    initialRemember?: boolean
    /** 「保存密码」初始勾选态 */
    initialSavePassword?: boolean
    /** 「自动登录」初始勾选态 */
    initialAutoLogin?: boolean
    /** 是否显示「注册 / 忘记密码」入口（AuthPage 自带分段切换，不需要） */
    showLinks?: boolean
  }>(),
  {
    rememberedEmail: '',
    initialRemember: true,
    initialSavePassword: false,
    initialAutoLogin: false,
    showLinks: true
  }
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
const savePassword = ref(props.initialSavePassword)
const autoLogin = ref(props.initialAutoLogin)
const busy = ref(false)
const msg = ref<{ ok: boolean; text: string } | null>(null)

/** 把「保存密码」的明文取回来填进密码框。只在保存密码=开、自动登录=关时才拿得到 */
async function prefillPassword(): Promise<void> {
  if (!props.initialSavePassword || props.initialAutoLogin) return
  try {
    const saved = await window.api.cloudSavedPassword()
    if (saved) password.value = saved
  } catch {
    // 拿不到就让用户自己输：预填是便利功能，不是登录的前提
  }
}
void prefillPassword()

function setMsg(ok: boolean, text: string): void {
  msg.value = { ok, text }
}

/** 勾选项变化立刻写回本机开关：写失败不影响登录（与主进程同款容错） */
async function persistFlag(key: 'cloudRememberAccount' | 'cloudSavePassword' | 'cloudAutoLogin', on: boolean): Promise<void> {
  try {
    await settings.update(key, on ? 1 : 0)
  } catch {
    // 开关是便利功能，写不进去不该让登录失败
  }
}

// 勾「自动登录」→ 自动勾上「记住邮箱」+「保存密码」：没有邮箱和密码就没法自动登
watch(autoLogin, (on) => {
  if (on) {
    remember.value = true
    savePassword.value = true
  }
  void persistFlag('cloudAutoLogin', on)
})

// 取消「保存密码」→ 自动取消「自动登录」，并**立刻**删掉本机密文
watch(savePassword, (on) => {
  void persistFlag('cloudSavePassword', on)
  if (on) return
  autoLogin.value = false
  try {
    void window.api.cloudForgetSavedPassword()
  } catch {
    // 删不掉密文最多是「下次还会预填」，不该让界面报错
  }
})

// 取消「记住邮箱」→ 清掉记住的邮箱
watch(remember, (on) => {
  void persistFlag('cloudRememberAccount', on)
  if (on) return
  try {
    void settings.update('cloudAccountEmail', '')
  } catch {
    // 同上
  }
})

/**
 * 登录成功后同步一份「记住邮箱」到界面的设置缓存。
 *
 * 邮箱的权威副本在主进程（signIn 里落的盘），这里只是让界面上的设置缓存跟上 ——
 * 否则退出登录后再看登录页，预填的还是上一次启动时读到的旧邮箱。
 * 写失败不影响登录结果。
 */
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
    const r = await window.api.cloudSignIn({
      email: mail,
      password: password.value,
      remember: remember.value,
      savePassword: savePassword.value,
      autoLogin: autoLogin.value
    })
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
      <input v-model="remember" type="checkbox" data-test="remember-email" />
      记住邮箱
    </label>

    <label class="remember">
      <input v-model="savePassword" type="checkbox" data-test="save-password" />
      保存密码
    </label>
    <p class="hint">密码经 Windows 凭据加密保存在本机，换电脑或换系统后无法读取。</p>

    <label class="remember">
      <input v-model="autoLogin" type="checkbox" data-test="auto-login" />
      自动登录
    </label>
    <p class="hint">下次启动用保存的邮箱和密码自动登录（需要联网）。</p>

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
  margin: 2px 0 0;
  cursor: pointer;
}
.remember input {
  width: 15px;
  height: 15px;
  accent-color: var(--accent);
}
.hint {
  margin: 4px 0 10px 22px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--txt3);
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
  margin-top: 6px;
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
