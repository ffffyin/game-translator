<script setup lang="ts">
import { computed, ref } from 'vue'
import { passwordStrength } from '../../../shared/account'

/**
 * 密码输入：明文/密文切换 + 可选强度条。
 *
 * 刻意**不加 maxlength**：粘贴一段超长密码时被静默截断，用户只会看到「密码错误」，
 * 却不知道开头几个字符丢了。长度问题交给 validatePassword 明确报错。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    autocomplete?: string
    disabled?: boolean
    showStrength?: boolean
    inputId?: string
  }>(),
  {
    placeholder: '请输入密码',
    autocomplete: 'off',
    disabled: false,
    showStrength: false,
    inputId: 'account-password'
  }
)

const emit = defineEmits<{
  'update:modelValue': [string]
  enter: []
}>()

const LEVELS = ['弱', '中', '较强', '强'] as const

const revealed = ref(false)
const strength = computed<0 | 1 | 2 | 3>(() => passwordStrength(props.modelValue))
const strengthLabel = computed<string>(() => (props.modelValue ? LEVELS[strength.value] : ''))

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}

function toggle(): void {
  revealed.value = !revealed.value
}
</script>

<template>
  <div class="pw">
    <div class="pw-box">
      <input
        :id="inputId"
        class="m-input"
        :type="revealed ? 'text' : 'password'"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :disabled="disabled"
        @input="onInput"
        @keyup.enter="emit('enter')"
      />
      <button
        type="button"
        class="eye"
        :disabled="disabled"
        :aria-label="revealed ? '隐藏密码' : '显示密码'"
        :title="revealed ? '隐藏密码' : '显示密码'"
        @click="toggle"
      >
        <svg v-if="!revealed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M2 12s3.6-6.2 10-6.2S22 12 22 12s-3.6 6.2-10 6.2S2 12 2 12z" />
          <circle cx="12" cy="12" r="2.6" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
          <path d="M4 4l16 16M10.6 10.6a2.6 2.6 0 003.8 3.8" />
          <path d="M7.3 7.4C4.8 8.9 2.9 11.4 2.4 12c0 0 3.6 6.2 10 6.2 1.3 0 2.5-.2 3.6-.6M18 16.4c2.2-1.7 3.6-4.4 4-4.4 0 0-3.6-6.2-10-6.2" />
        </svg>
      </button>
    </div>

    <div v-if="showStrength && modelValue" class="strength" :class="`s${strength}`">
      <span class="bar"><i :class="`f${strength}`"></i></span>
      <span class="txt">强度：{{ strengthLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.pw {
  width: 100%;
}
.pw-box {
  position: relative;
  display: flex;
}
.pw-box .m-input {
  padding-right: 38px;
}
.eye {
  position: absolute;
  top: 0;
  right: 0;
  width: 38px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--txt3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.eye svg {
  width: 16px;
  height: 16px;
}
.eye:hover {
  color: var(--txt2);
}
.eye:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.strength {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
  font-size: 11px;
}
.bar {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--card2);
  border: 1px solid var(--line);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--txt3);
}
.bar .f0 {
  width: 25%;
}
.bar .f1 {
  width: 50%;
}
.bar .f2 {
  width: 75%;
}
.bar .f3 {
  width: 100%;
}
.strength.s0 .bar i {
  background: var(--danger);
}
.strength.s0 .txt {
  color: var(--danger);
}
.strength.s1 .bar i {
  background: var(--txt3);
}
.strength.s1 .txt {
  color: var(--txt3);
}
.strength.s2 .bar i,
.strength.s3 .bar i {
  background: var(--teal);
}
.strength.s2 .txt,
.strength.s3 .txt {
  color: var(--teal);
}
</style>
