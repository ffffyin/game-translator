<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

// 自绘标题栏：背景/文字/按钮全部使用应用主题变量（--side / --line / --txt2），
// 因此深色、浅色与强调色切换时顶部栏会与整体一起变色。
const maximized = ref(false)
let offMaximize: (() => void) | null = null

function minimize(): void {
  window.api.windowMinimize()
}

function toggleMaximize(): void {
  window.api.windowToggleMaximize()
}

function close(): void {
  window.api.windowClose()
}

onMounted(async () => {
  try {
    maximized.value = await window.api.windowIsMaximized()
    offMaximize = window.api.onWindowMaximized((v) => {
      maximized.value = v
    })
  } catch {
    // 预览/测试环境无窗口 API 时忽略
  }
})

onBeforeUnmount(() => offMaximize?.())
</script>

<template>
  <header class="titlebar" @dblclick="toggleMaximize">
    <div class="tb-left">
      <span class="tb-logo">译</span>
      <span class="tb-title">游戏翻译助手</span>
    </div>

    <div class="tb-actions">
      <button class="tb-btn" type="button" title="最小化" @click="minimize">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6h8" /></svg>
      </button>
      <button
        class="tb-btn"
        type="button"
        :title="maximized ? '向下还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg v-if="!maximized" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2.5" y="2.5" width="7" height="7" rx="1" />
        </svg>
        <svg v-else viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2.5" y="4.5" width="5" height="5" rx="1" />
          <path d="M4.5 4.5V3.2h4.3v4.3H7.6" />
        </svg>
      </button>
      <button class="tb-btn close" type="button" title="关闭" @click="close">
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" /></svg>
      </button>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
  height: 42px;
  flex-shrink: 0;
  background: var(--side);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-left: 14px;
  user-select: none;
  -webkit-app-region: drag;
}
.tb-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tb-logo {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: var(--accent);
  color: #161a21;
  font-size: 11px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
}
.tb-title {
  font-size: 12.5px;
  color: var(--txt3);
  letter-spacing: 0.5px;
}
.tb-actions {
  display: flex;
  align-items: stretch;
  height: 100%;
  -webkit-app-region: no-drag;
}
.tb-btn {
  width: 46px;
  height: 100%;
  border: none;
  background: transparent;
  color: var(--txt2);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}
.tb-btn svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.2;
  stroke-linecap: round;
}
.tb-btn:hover {
  background: color-mix(in srgb, var(--txt) 12%, transparent);
  color: var(--txt);
}
.tb-btn.close:hover {
  background: var(--danger);
  color: #ffffff;
}
</style>
