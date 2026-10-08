<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { NotifyPayload } from '../../shared/api-contract'

interface Toast extends NotifyPayload {
  id: number
}

const list = ref<Toast[]>([])
let seq = 0

onMounted(() =>
  window.api.onNotify((p) => {
    const id = ++seq
    if (p.type === 'loading') list.value = list.value.filter((t) => t.type !== 'loading')
    list.value.push({ id, ...p })
    if (p.type !== 'loading') {
      setTimeout(() => {
        list.value = list.value.filter((t) => t.id !== id)
      }, 2800)
    }
  })
)
</script>

<template>
  <div class="toasts">
    <div v-for="t in list" :key="t.id" class="toast" :class="t.type">
      <span class="dot"></span>
      {{ t.message }}
    </div>
  </div>
</template>

<style scoped>
.toasts {
  position: fixed;
  top: 18px;
  right: 22px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  z-index: 9999;
}
.toast {
  background: var(--card);
  border: 1px solid var(--line);
  border-left: 3px solid var(--txt3);
  border-radius: 9px;
  padding: 9px 16px 9px 12px;
  font-size: 12.5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 200px;
}
.toast .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--txt3);
}
.toast.ok {
  border-left-color: var(--teal);
}
.toast.ok .dot {
  background: var(--teal);
}
.toast.error {
  border-left-color: var(--danger);
}
.toast.error .dot {
  background: var(--danger);
}
.toast.loading .dot {
  background: var(--accent);
  animation: pulse 1s infinite;
}
.toast.info {
  border-left-color: var(--accent);
}
.toast.info .dot {
  background: var(--accent);
}
@keyframes pulse {
  50% {
    opacity: 0.3;
  }
}
</style>
