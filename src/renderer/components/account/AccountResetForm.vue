<script setup lang="ts">
import { onUnmounted, ref } from 'vue'
import PasswordField from './PasswordField.vue'
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  validateCode,
  validateEmail,
  validatePassword
} from '../../../shared/account'
import { friendlyError, friendlyOk } from '../../utils/message'
import { useAuthStore } from '../../stores/auth'

/**
 * 忘记密码：邮箱验证码验证身份后直接设置新密码（不要求原密码）。
 *
 * 主进程在重置成功后会顺手用新密码登录，因此这里必须按「是否已自动登录」分两条路走，
 * 判定条件是 `r.ok && r.status.signedIn` —— 只看 ok 会把「重置成功但没登进去」
 * 也当成成功，反过来只看 signedIn 又会在两种都失败时漏掉错误提示。
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
  /** 重置成功且主进程已用新密码自动登录：直接进入软件 */
  'signed-in': []
  /** 重置成功但未登录成功：带着提示文案回到登录页 */
  done: [message: string]
  'go-login': []
}>()

/** 与注册链路一致：发码限流 1 条/分钟/邮箱 */
const OTP_COOLDOWN_SECONDS = 60

const auth = useAuthStore()

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
    const r = await window.api.cloudSendOtp(mail, 'reset')
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
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
  setMsg(true, '正在重置密码…')
  try {
    const r = await window.api.cloudResetPassword({
      email: mail,
      verificationId: verificationId.value,
      code: code.value.trim(),
      newPassword: password.value
    })
    // 重置失败时 status 只是「当前是什么样」，不代表成功，直接报错即可
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    auth.applyStatus(r.status)
    password.value = ''
    confirm.value = ''
    code.value = ''
    verificationId.value = ''

    if (r.status?.signedIn === true) {
      // 主进程已经用新密码把会话建好了：直接进软件，不再让用户重输一遍
      setMsg(true, friendlyOk(r.message, '密码已重置，已自动登录'))
      emit('signed-in')
      return
    }
    setMsg(true, friendlyOk(r.message, '密码已重置，请用新密码登录'))
    emit('done', friendlyOk(r.message, '密码已重置，请用新密码登录'))
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="reset" @submit.prevent="submit">
    <div class="f-row">
      <label>邮箱</label>
      <div class="inline">
        <input v-model="email" class="m-input" placeholder="注册时使用的邮箱" autocomplete="off" />
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
      <label>新密码</label>
      <PasswordField
        v-model="password"
        input-id="reset-password"
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
        input-id="reset-password-confirm"
        placeholder="请再输入一次"
        autocomplete="new-password"
        @enter="submit"
      />
    </div>

    <div v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'error'">{{ msg.text }}</div>

    <button class="m-btn accent submit" type="submit" :disabled="submitting">
      {{ submitting ? '提交中…' : '重置密码' }}
    </button>

    <!-- AuthPage 自带分段切换，这里的返回入口就多余了；独立使用时才显示 -->
    <div v-if="showLinks" class="links">
      <span class="dim">想起密码了？</span>
      <button type="button" class="link" @click="emit('go-login')">返回登录</button>
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
