<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  show: boolean
  actionCode: string
  label: string
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const liveAccelerator = ref('')
const errorMsg = ref('')
const saving = ref(false)

function keyName(e: KeyboardEvent): string {
  const k = e.key
  if (k === ' ') return 'Space'
  if (k.length === 1) return k.toUpperCase()
  return k
}

function buildAccelerator(e: KeyboardEvent): string {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  if (e.metaKey) mods.push('Super')
  return [...mods, keyName(e)].join('+')
}

function isModifierKey(k: string): boolean {
  return ['Control', 'Alt', 'Shift', 'Meta'].includes(k)
}

async function onKeydown(e: KeyboardEvent) {
  e.preventDefault()
  e.stopPropagation()
  if (isModifierKey(e.key)) return
  const acc = buildAccelerator(e)
  liveAccelerator.value = acc
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) {
    saving.value = true
    errorMsg.value = ''
    const r = await window.api.hotkeysRebind(props.actionCode, acc)
    saving.value = false
    if (r.ok) {
      emit('saved')
    } else {
      errorMsg.value = r.error ?? '修改失败'
    }
  } else {
    errorMsg.value = '请至少包含一个修饰键（Ctrl / Alt / Shift）'
  }
}

watch(
  () => props.show,
  (v) => {
    if (v) {
      liveAccelerator.value = ''
      errorMsg.value = ''
      window.addEventListener('keydown', onKeydown, true)
    } else {
      window.removeEventListener('keydown', onKeydown, true)
    }
  }
)

onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown, true))
</script>

<template>
  <div v-if="show" class="mask" @click.self="emit('close')">
    <div class="modal">
      <h4>修改快捷键</h4>
      <p class="act">{{ label }}</p>

      <div class="capture">
        <span v-if="liveAccelerator">{{ liveAccelerator }}</span>
        <span v-else class="hint">请按下新的组合键…</span>
      </div>

      <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
      <p v-if="saving" class="loading">正在注册…</p>

      <div class="modal-actions">
        <button class="m-btn" @click="emit('close')">取消</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  background: rgba(5, 7, 10, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9000;
}
.modal {
  width: 380px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 22px 24px;
}
h4 {
  font-size: 15px;
}
.act {
  font-size: 12px;
  color: var(--txt3);
  margin-top: 2px;
}
.capture {
  margin: 18px 0 10px;
  background: var(--card2);
  border: 1px dashed var(--accent-line);
  border-radius: 10px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: var(--accent);
}
.capture .hint {
  font-size: 13px;
  font-weight: 400;
  color: var(--txt3);
}
.err {
  color: var(--danger);
  font-size: 12px;
}
.loading {
  color: var(--accent);
  font-size: 12px;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 14px;
}
</style>
