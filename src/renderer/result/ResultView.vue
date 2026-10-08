<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { ResultData, RetranslateRequest } from '../../shared/result'

const data = ref<ResultData | null>(null)
const pinned = ref(false)
const busy = ref(false)
const errorMsg = ref('')

const engine = ref<'local' | 'vision'>('local')
const style = ref('auto')

onMounted(() => {
  window.api.onResultData((d) => {
    data.value = d
    engine.value = d.currentEngine
    style.value = d.currentStyle
  })
})

async function retranslate() {
  if (!data.value) return
  busy.value = true
  errorMsg.value = ''
  const req: RetranslateRequest = { engine: engine.value, style: style.value }
  const r = await window.api.resultRetranslate(req)
  busy.value = false
  if (!r.ok) errorMsg.value = r.error ?? '重新翻译失败'
}

async function copyAll() {
  if (!data.value) return
  const text = data.value.pairs.map((p) => p.translation).join('\n')
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    window.api.resultCopy(text)
  }
}

function togglePin() {
  pinned.value = !pinned.value
  window.api.resultSetPinned(pinned.value)
}

function close(): void {
  window.api.resultClose()
}
</script>

<template>
  <div class="result-win" :class="{ loading: !data }">
    <header class="head">
      <div class="title">
        <span class="dot"></span>
        <b>{{ data ? data.directionLabel : '翻译中…' }}</b>
      </div>
      <div class="win-actions">
        <button class="w-btn" :class="{ on: pinned }" title="置顶锁定（锁定后不自动关闭）"
          @click="togglePin">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path fill="currentColor" d="M16 3l5 5-3 1-2.5 2.5.3 3.5-2 2-3.8-3.8L5 18l-1-1 4.8-4.8L5 8.4l2-2 3.5.3L13 4.2 14 1z"/>
          </svg>
        </button>
        <button class="w-btn" title="关闭" @click="close">
          <svg viewBox="0 0 24 24" width="14" height="14">
            <path fill="currentColor" d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13l-6.3 6.3-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4L10.6 11l6.3-6.3z"/>
          </svg>
        </button>
      </div>
    </header>

    <template v-if="data">
      <div class="meta">
        <span class="engine-badge" :class="data.engine">
          {{ data.engine === 'vision' ? 'AI 视觉' : '本地 OCR' }}
        </span>
        <span class="count">{{ data.pairs.length }} 组文本</span>
      </div>

      <div class="pairs">
        <div v-for="p in data.pairs" :key="p.id" class="pair">
          <p class="orig">{{ p.original }}</p>
          <p class="trans">{{ p.translation }}</p>
        </div>
        <p v-if="data.pairs.length === 0" class="empty">未识别到文字</p>
      </div>

      <div class="controls">
        <select v-model="engine" title="识别通道">
          <option v-for="o in data.engineOptions" :key="o.value" :value="o.value"
            :disabled="o.value === 'vision' && !data.canVision">
            {{ o.label }}
          </option>
        </select>
        <select v-model="style" title="翻译风格">
          <option v-for="o in data.styleOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <button class="r-btn" :disabled="busy" @click="retranslate">
          {{ busy ? '处理中…' : '重新翻译' }}
        </button>
        <button class="r-btn accent" @click="copyAll">复制译文</button>
      </div>
      <p v-if="errorMsg" class="err">{{ errorMsg }}</p>
    </template>

    <div v-else class="spinner"></div>
  </div>
</template>

<style scoped>
.result-win {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  overflow: hidden;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: var(--card2);
  border-bottom: 1px solid var(--line);
  -webkit-app-region: drag;
}
.title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title b {
  font-size: 12.5px;
}
.title .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--teal);
}
.win-actions {
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.w-btn {
  border: none;
  background: transparent;
  color: var(--txt2);
  padding: 3px;
  border-radius: 5px;
  cursor: pointer;
  display: flex;
}
.w-btn:hover {
  background: var(--line);
  color: var(--txt);
}
.w-btn.on {
  color: var(--accent);
}
.meta {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 13px 4px;
}
.engine-badge {
  font-size: 10.5px;
  padding: 2px 8px;
  border-radius: 5px;
  border: 1px solid var(--teal);
  color: var(--teal);
}
.engine-badge.vision {
  border-color: var(--accent);
  color: var(--accent);
}
.count {
  font-size: 11px;
  color: var(--txt3);
}
.pairs {
  flex: 1;
  overflow-y: auto;
  padding: 4px 13px 8px;
}
.pair {
  padding: 8px 0;
  border-bottom: 1px solid var(--line);
}
.pair:last-child {
  border-bottom: none;
}
.orig {
  font-size: 12px;
  color: var(--txt3);
  margin: 0 0 4px;
  white-space: pre-wrap;
}
.trans {
  font-size: 13.5px;
  color: var(--txt);
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.5;
}
.empty {
  font-size: 12.5px;
  color: var(--txt3);
  text-align: center;
  padding: 24px 0;
}
.controls {
  display: flex;
  gap: 7px;
  padding: 9px 12px 12px;
  border-top: 1px solid var(--line);
}
.controls select {
  flex: 1;
  min-width: 0;
  background: var(--card2);
  border: 1px solid var(--line);
  color: var(--txt);
  border-radius: 7px;
  font-size: 11.5px;
  padding: 6px 4px;
}
.r-btn {
  background: var(--card2);
  border: 1px solid var(--line);
  color: var(--txt);
  border-radius: 7px;
  font-size: 11.5px;
  padding: 6px 11px;
  cursor: pointer;
  white-space: nowrap;
}
.r-btn:hover {
  border-color: var(--accent-line);
}
.r-btn.accent {
  background: var(--accent);
  border-color: var(--accent);
  color: #1a1408;
  font-weight: 600;
}
.r-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.err {
  color: var(--danger);
  font-size: 11.5px;
  margin: -4px 13px 8px;
}
.spinner {
  width: 26px;
  height: 26px;
  margin: 60px auto;
  border: 3px solid var(--line);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
