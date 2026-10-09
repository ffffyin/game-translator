<script setup lang="ts">
// 启动时自动检查到新版本后弹出的三选一对话框。
//
// 组件本身是「哑」的：只负责展示与抛出用户的选择，打开下载链接、写跳过标记
// 这些副作用都由 App.vue 处理 —— 它才有 settings store 与 IPC 的上下文。
import { computed } from 'vue'
import { formatBytes, type UpdateInfo } from '../../shared/update'

const props = defineProps<{
  info: UpdateInfo
}>()

const emit = defineEmits<{
  // 「更新新版本」：带上下载地址，由父层用 shell.openExternal 打开
  (e: 'update', downloadUrl: string): void
  // 「跳过此新版本并不再提醒」：带上要记住的版本号
  (e: 'skip', version: string): void
  // 「下次再说」：什么都不做，仅关闭
  (e: 'later'): void
}>()

const sizeText = computed(() => formatBytes(props.info.size))
</script>

<template>
  <div class="mask">
    <div class="modal">
      <h4>
        发现新版本 v{{ info.version }}
        <em v-if="info.mandatory" class="tag">强烈建议更新</em>
      </h4>
      <p v-if="info.mandatory" class="mandatory-tip">该版本修复了重要问题，建议尽快升级。</p>
      <p v-if="info.publishedAt" class="sub">发布日期 {{ info.publishedAt }}</p>

      <ul v-if="info.notes.length" class="notes">
        <li v-for="(n, i) in info.notes" :key="i">{{ n }}</li>
      </ul>

      <p v-if="sizeText" class="sub">安装包大小 {{ sizeText }}</p>

      <div class="modal-actions">
        <button class="m-btn" @click="emit('skip', info.version)">跳过此版本</button>
        <button class="m-btn" @click="emit('later')">下次再说</button>
        <button class="m-btn accent" @click="emit('update', info.downloadUrl)">立即更新</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 沿用 HotkeyModal 的居中遮罩层写法 */
.mask {
  position: fixed;
  inset: 0;
  background: rgba(5, 7, 10, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9500;
}
.modal {
  width: 420px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 22px 24px;
}
h4 {
  font-size: 15px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.tag {
  font-style: normal;
  font-size: 10px;
  font-weight: 500;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: 4px;
  padding: 1px 4px;
}
.mandatory-tip {
  margin-top: 6px;
  font-size: 12px;
  color: var(--danger);
}
.sub {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--txt3);
  line-height: 1.6;
}
.notes {
  margin: 10px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 3px;
}
.notes li {
  font-size: 12.5px;
  color: var(--txt2);
  line-height: 1.65;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
