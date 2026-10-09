<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import PasswordField from './PasswordField.vue'
import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  normalizeNickname,
  validateCode,
  validateEmail,
  validateNickname,
  validatePassword
} from '../../../shared/account'
import { friendlyError, friendlyOk } from '../../utils/message'
import { useAuthStore } from '../../stores/auth'

/**
 * 注册：邮箱 + 邮箱验证码 + 密码。
 *
 * 昵称只在这里收集一次，写入快照仅作展示 —— 云端没有可写的账号名字段，
 * 它**不参与登录**，也不做查重。
 */
const props = withDefaults(
  defineProps<{
    initialEmail?: string
    /** 是否显示「返回登录」入口（AuthPage 自带分段切换，不需要） */
    showLinks?: boolean
  }>(),
  { initialEmail: '', showLinks: true }
)

const emit = defineEmits<{
  success: []
  'go-login': []
}>()

const auth = useAuthStore()

/** 发码限流是 1 条/分钟/邮箱，第二次就是 429 —— 倒计时必须与之对齐 */
const OTP_COOLDOWN_SECONDS = 60

const nickname = ref('')
const email = ref(props.initialEmail)
const code = ref('')
const password = ref('')
const confirm = ref('')
const verificationId = ref('')

const sending = ref(false)
const submitting = ref(false)
const cooldown = ref(0)
const msg = ref<{ ok: boolean; text: string } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

function setMsg(ok: boolean, text: string): void {
  msg.value = { ok, text }
}

function stopTimer(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function startCooldown(): void {
  cooldown.value = OTP_COOLDOWN_SECONDS
  stopTimer()
  timer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0) {
      cooldown.value = 0
      stopTimer()
    }
  }, 1000)
}

onUnmounted(stopTimer)

// 除了按钮 disabled，这里再挡一道：连点两次会吃一条 429，
// 用户看到的是「发送失败」，实际原因却是自己手快。
async function sendCode(): Promise<void> {
  if (sending.value || cooldown.value > 0) return

  const mail = email.value.trim()
  const mailCheck = validateEmail(mail)
  if (!mailCheck.ok) {
    setMsg(false, mailCheck.message)
    return
  }

  sending.value = true
  setMsg(true, '正在发送验证码…')
  try {
    const r = await window.api.cloudSendOtp(mail, 'register')
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    if (r.isExistingUser) {
      setMsg(false, '该邮箱已注册，请回到登录页用密码登录')
      return
    }
    verificationId.value = r.verificationId
    startCooldown()
    setMsg(true, friendlyOk(r.message, '验证码已发送，请查收邮件'))
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    sending.value = false
  }
}

async function submit(): Promise<void> {
  if (submitting.value) return

  const nickCheck = validateNickname(nickname.value)
  if (!nickCheck.ok) {
    setMsg(false, nickCheck.message)
    return
  }
  const mail = email.value.trim()
  const mailCheck = validateEmail(mail)
  if (!mailCheck.ok) {
    setMsg(false, mailCheck.message)
    return
  }
  const codeCheck = validateCode(code.value)
  if (!codeCheck.ok) {
    setMsg(false, codeCheck.message)
    return
  }
  if (!verificationId.value) {
    setMsg(false, '请先获取邮箱验证码')
    return
  }
  const pwdCheck = validatePassword(password.value)
  if (!pwdCheck.ok) {
    setMsg(false, pwdCheck.message)
    return
  }
  if (password.value !== confirm.value) {
    setMsg(false, '两次输入的密码不一致')
    return
  }

  submitting.value = true
  setMsg(true, '正在注册…')
  try {
    const r = await window.api.cloudSignUp({
      nickname: normalizeNickname(nickname.value),
      email: mail,
      password: password.value,
      verificationId: verificationId.value,
      code: code.value.trim()
    })
    auth.applyStatus(r.status)
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    password.value = ''
    confirm.value = ''
    code.value = ''
    verificationId.value = ''
    setMsg(true, friendlyOk(r.message, '注册成功，已登录'))
    emit('success')
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="reg" @submit.prevent="submit">
    <div class="f-row">
      <label>昵称</label>
      <input v-model="nickname" class="m-input" placeholder="仅用于展示，不参与登录" autocomplete="off" />
    </div>

    <div class="f-row">
      <label>邮箱</label>
      <div class="inline">
        <input v-model="email" class="m-input" placeholder="you@example.com" autocomplete="off" />
        <button
          type="button"
          class="m-btn send-btn"
          :disabled="sending || cooldown > 0"
          @click="sendCode"
        >
          {{ cooldown > 0 ? `${cooldown} 秒后重发` : sending ? '发送中…' : '获取验证码' }}
        </button>
      </div>
    </div>

    <div class="f-row">
      <label>验证码</label>
      <input v-model="code" class="m-input otp" placeholder="邮箱里收到的数字验证码" autocomplete="one-time-code" />
    </div>

    <div class="f-row">
      <label>密码</label>
      <PasswordField
        v-model="password"
        input-id="register-password"
        :placeholder="`${PASSWORD_MIN}-${PASSWORD_MAX} 位`"
        autocomplete="new-password"
        show-strength
        @enter="submit"
      />
    </div>

    <div class="f-row">
      <label>确认密码</label>
      <PasswordField
        v-model="confirm"
        input-id="register-password-confirm"
        placeholder="请再输入一次"
        autocomplete="new-password"
        @enter="submit"
      />
    </div>

    <div v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'error'">{{ msg.text }}</div>

    <button class="m-btn accent submit" type="submit" :disabled="submitting">
      {{ submitting ? '注册中…' : '注册并登录' }}
    </button>

    <!-- AuthPage 自带分段切换，这里的返回入口就多余了；独立使用时才显示 -->
    <div v-if="showLinks" class="links">
      <span class="dim">已有账号？</span>
      <button type="button" class="link" @click="emit('go-login')">返回登录</button>
      <span class="dim nick-tip">· 昵称 {{ NICKNAME_MIN }}-{{ NICKNAME_MAX }} 字符</span>
    </div>
    <p v-else class="dim nick-tip solo-tip">昵称 {{ NICKNAME_MIN }}-{{ NICKNAME_MAX }} 字符</p>
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
.inline {
  display: flex;
  gap: 8px;
}
.inline .m-input {
  flex: 1;
}
.send-btn {
  flex-shrink: 0;
  white-space: nowrap;
}
.send-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.otp {
  letter-spacing: 2px;
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
  gap: 6px;
  margin-top: 14px;
  font-size: 12px;
}
.dim {
  color: var(--txt3);
}
.nick-tip {
  margin-left: 2px;
}
/* AuthPage 里不显示「返回登录」，这句提示单独占一行 */
.solo-tip {
  margin: 12px 0 0;
  text-align: center;
  font-size: 11.5px;
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
</style>
