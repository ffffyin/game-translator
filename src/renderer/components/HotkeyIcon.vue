<script setup lang="ts">
// 快捷键动作图标（设计稿 4.1）：24×24 描边风格，颜色随 currentColor
defineProps<{ code: string }>()
</script>

<template>
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
  >
    <!-- 全选翻译并自动替换：双向箭头 -->
    <template v-if="code === 'translate_replace'">
      <path d="M4 8h13l-4-4M20 16H7l4 4" />
    </template>
    <!-- 全选翻译进剪贴板：剪贴板 -->
    <template v-else-if="code === 'translate_clipboard'">
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4a3 3 0 016 0M9 11h6M9 15h4" />
    </template>
    <!-- 截图区域翻译：选区框 -->
    <template v-else-if="code === 'capture_region'">
      <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" />
    </template>
    <!-- 截图全屏翻译：四角展开 -->
    <template v-else-if="code === 'capture_fullscreen'">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </template>
    <!-- 兜底：圆点 -->
    <circle v-else cx="12" cy="12" r="3" />
  </svg>
</template>
