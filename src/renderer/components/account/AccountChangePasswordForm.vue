<script setup lang="ts">
import { ref } from 'vue'
import PasswordField from './PasswordField.vue'
import { validatePassword } from '../../../shared/account'
import { friendlyError, friendlyOk } from '../../utils/message'

const emit = defineEmits<{
  done: []
  cancel: []
}>()

const oldPassword = ref('')
const newPassword = ref('')
const confirm = ref('')
const submitting = ref(false)
const msg = ref<{ ok: boolean; text: string } | null>(null)

function setMsg(ok: boolean, text: string): void {
  msg.value = { ok, text }
}

async function submit(): Promise<void> {
  if (submitting.value) return

  if (!oldPassword.value) {
    setMsg(false, '请输入当前密码')
    return
  }
  const pwdCheck = validatePassword(newPassword.value)
  if (!pwdCheck.ok) {
    setMsg(false, pwdCheck.message)
    return
  }
  if (newPassword.value === oldPassword.value) {
    setMsg(false, '新密码不能与当前密码相同')
    return
  }
  if (newPassword.value !== confirm.value) {
    setMsg(false, '两次输入的新密码不一致')
    return
  }

  submitting.value = true
  setMsg(true, '正在修改…')
  try {
    const r = await window.api.cloudChangePassword({
      oldPassword: oldPassword.value,
      newPassword: newPassword.value
    })
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    oldPassword.value = ''
    newPassword.value = ''
    confirm.value = ''
    setMsg(true, friendlyOk(r.message, '密码已修改，下次登录请用新密码'))
    emit('done')
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <form class="chg" @submit.prevent="submit">
    <div class="f-row">
      <label>当前密码</label>
      <PasswordField
        v-model="oldPassword"
        input-id="change-old-password"
        placeholder="当前正在使用的密码"
        autocomplete="current-password"
        @enter="submit"
      />
    </div>

    <div class="f-row">
      <label>新密码</label>
      <PasswordField
        v-model="newPassword"
        input-id="change-new-password"
        placeholder="6-60 位"
        autocomplete="new-password"
        show-strength
        @enter="submit"
      />
    </div>

    <div class="f-row">
      <label>确认新密码</label>
      <PasswordField
        v-model="confirm"
        input-id="change-new-password-confirm"
        placeholder="请再输入一次"
        autocomplete="new-password"
        @enter="submit"
      />
    </div>

    <div v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'error'">{{ msg.text }}</div>

    <div class="actions">
      <button type="button" class="m-btn" :disabled="submitting" @click="emit('cancel')">取消</button>
      <button type="submit" class="m-btn accent" :disabled="submitting">
        {{ submitting ? '提交中…' : '确认修改' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.f-row {
  display: grid;
  grid-template-columns: 82px 1fr;
  align-items: start;
  gap: 10px;
  margin-bottom: 12px;
}
.f-row label {
  font-size: 12.5px;
  color: var(--txt2);
  line-height: 36px;
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
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.m-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
