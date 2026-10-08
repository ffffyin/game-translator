<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { NotifyPayload } from '../../shared/api-contract'

interface Toast {
  id: number
  type: NotifyPayload['type']
  message: string
}

// ok / error / info 展示时长
const DONE_TTL_MS = 2800
// 进行中（loading）提示的兜底最长存活时间：
// 主进程若走了异常路径没下发结束通知，提示也必须自己消失，不能永久挂在右上角
const LOADING_MAX_MS = 90_000

const list = ref<Toast[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let seq = 0

function drop(id: number): void {
  const t = timers.get(id)
  if (t) {
    clearTimeout(t)
    timers.delete(id)
  }
  list.value = list.value.filter((x) => x.id !== id)
}

function arm(id: number, ms: number): void {
  const old = timers.get(id)
  if (old) clearTimeout(old)
  timers.set(id, setTimeout(() => drop(id), ms))
}

// 清掉所有"进行中"提示：任务结束或进入新阶段时调用
function clearLoading(): void {
  for (const t of list.value) if (t.type === 'loading') drop(t.id)
}

onMounted(() => {
  window.api.onNotify((p) => {
    if (p.type === 'loading') {
      // 就地更新同一条进行中提示：截图翻译每 15 秒刷新进度，
      // 重建 DOM 会闪，也会让兜底计时器永远被重置
      const cur = list.value.find((t) => t.type === 'loading')
      if (cur) {
        cur.message = p.message
        arm(cur.id, LOADING_MAX_MS)
        return
      }
      const id = ++seq
      list.value = [...list.value, { id, type: 'loading', message: p.message }]
      arm(id, LOADING_MAX_MS)
      return
    }
    // ok / error / info 表示任务已结束：进行中提示必须移除，
    // 否则会出现"没有翻译任务却一直显示正在读取并翻译"
    clearLoading()
    const id = ++seq
    list.value = [...list.value, { id, type: p.type, message: p.message }]
    arm(id, DONE_TTL_MS)
  })
})

onUnmounted(() => {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
})
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
