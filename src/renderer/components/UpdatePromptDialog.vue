<script setup lang="ts">
// 启动时自动检查到新版本后弹出的对话框。
//
// 点击「立即更新」后不再关闭弹窗：下载、装包都在这一个框里走完，
// 免得用户还得到「关于软件」页再点一遍。跳过 / 下次再说仍然交给 App.vue，
// 因为写本机设置这件事只有它那边才有 settings store。
import { computed } from 'vue'
import { useUpdateDownloadStore } from '../stores/update-download'
import { formatBytes, type UpdateInfo } from '../../shared/update'

const props = defineProps<{
  info: UpdateInfo
}>()

const emit = defineEmits<{
  // 「跳过此新版本并不再提醒」：带上要记住的版本号
  (e: 'skip', version: string): void
  // 「下次再说」：什么都不做，仅关闭
  (e: 'later'): void
}>()

const sizeText = computed(() => formatBytes(props.info.size))

// 与「关于软件」页共用同一份下载状态（同一个 Pinia store 实例）
const dl = useUpdateDownloadStore()

function startDownload(): void {
  void dl.start(props.info.downloadUrl, props.info.sha256, props.info.size)
}
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

      <!-- 下载中：只留一个取消，别让用户在这里误触「跳过」把进度丢了 -->
      <template v-if="dl.phase === 'downloading'">
        <div class="progress">
          <i :style="{ width: dl.percent + '%' }"></i>
        </div>
        <p class="sub">正在下载…{{ dl.percent }}%</p>
        <div class="modal-actions">
          <button class="m-btn" @click="dl.cancel()">取消下载</button>
        </div>
      </template>

      <!-- 下载完成 -->
      <template v-else-if="dl.phase === 'done'">
        <p class="done-tip">已下载到 {{ dl.path }}，点击下方按钮后软件会退出并启动安装程序</p>
        <div class="modal-actions">
          <button class="m-btn" @click="dl.reveal()">打开所在文件夹</button>
          <button class="m-btn accent" @click="dl.install()">安装并重启</button>
        </div>
      </template>

      <!-- 下载失败：给原因 + 重试，另外留一条关掉弹窗的退路 -->
      <template v-else-if="dl.phase === 'error'">
        <p class="err">{{ dl.message }}</p>
        <div class="modal-actions">
          <button class="m-btn" @click="emit('later')">下次再说</button>
          <button class="m-btn accent" @click="startDownload">重试下载</button>
        </div>
      </template>

      <!-- idle：三个选择 -->
      <template v-else>
        <div class="modal-actions">
          <button class="m-btn" @click="emit('skip', info.version)">跳过此版本</button>
          <button class="m-btn" @click="emit('later')">下次再说</button>
          <button class="m-btn accent" @click="startDownload">立即更新</button>
        </div>
      </template>
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
.done-tip {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--txt2);
  line-height: 1.6;
  word-break: break-all;
}
.err {
  margin-top: 10px;
  font-size: 12px;
  color: var(--danger);
  line-height: 1.6;
}
.progress {
  margin-top: 14px;
  height: 4px;
  border-radius: 999px;
  background: var(--card2);
  overflow: hidden;
}
.progress i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width 0.2s linear;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 18px;
}
</style>
