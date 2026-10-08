<script setup lang="ts">
import { ref, onMounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { APP_VERSION } from '../../shared/version'
import type { LibView } from '../../shared/terms'
import type { BackupFile } from '../../shared/api-contract'

const dataDir = ref('')
const libs = ref<LibView[]>([])
const checking = ref(false)
const updateMsg = ref('')
const backups = ref<BackupFile[]>([])
const restoreTarget = ref('')

async function refreshBackups(): Promise<void> {
  backups.value = await window.api.backupList()
}

async function createManualBackup(): Promise<void> {
  backups.value = await window.api.backupCreate()
}

async function confirmRestore(name: string): Promise<void> {
  await window.api.backupRestore(name)
}

async function openDataDir(): Promise<void> {
  await window.api.openDataDir()
}

// 第一版无远程更新服务器：只做本地版本确认并如实说明
function checkAppUpdate(): void {
  checking.value = true
  updateMsg.value = ''
  setTimeout(() => {
    checking.value = false
    updateMsg.value = `当前已是最新版本 v${APP_VERSION}（第一版未配置在线更新）`
  }, 600)
}

onMounted(async () => {
  dataDir.value = await window.api.getDataDir()
  libs.value = await window.api.termsListLibs()
  await refreshBackups()
})
</script>

<template>
  <PageHeader title="关于软件" />

  <div class="grid">
    <div class="m-card main">
      <div class="logo">译</div>
      <h4>游戏翻译助手</h4>
      <p class="en">Game Translator</p>
      <p class="ver">版本 v{{ APP_VERSION }}</p>
      <p class="author">作者：fygod</p>
      <button class="m-btn" :disabled="checking" @click="checkAppUpdate">
        {{ checking ? '检查中…' : '检查软件更新' }}
      </button>
      <p v-if="updateMsg" class="update-msg">{{ updateMsg }}</p>
    </div>

    <div class="right-col">
      <div class="m-card">
        <div class="lab">数据与隐私</div>
        <p class="txt">所有设置、模型配置、术语库与常用语均保存在本机，不上传任何服务器；翻译请求仅发往你配置的模型厂商。</p>
        <p class="path-label">数据目录：</p>
        <p class="path">{{ dataDir }}</p>
        <button class="m-btn" @click="openDataDir">打开数据目录</button>
      </div>

      <div class="m-card">
        <div class="lab">备份与恢复</div>
        <p class="txt">每日首次启动会自动备份数据库，至少保留最近 7 份；还原后软件将自动重启。</p>
        <button class="m-btn" @click="createManualBackup">立即备份</button>
        <div v-if="backups.length" class="bk-list">
          <div v-for="b in backups" :key="b.name" class="bk-row">
            <div class="bk-meta">
              <span class="bk-name">{{ b.name }}</span>
              <i>{{ new Date(b.mtime).toLocaleString() }} · {{ Math.round(b.size / 1024) }} KB</i>
            </div>
            <template v-if="restoreTarget === b.name">
              <button class="m-btn danger" @click="confirmRestore(b.name)">确认还原</button>
              <button class="m-btn ghost" @click="restoreTarget = ''">取消</button>
            </template>
            <button v-else class="m-btn ghost" @click="restoreTarget = b.name">还原</button>
          </div>
        </div>
        <p v-else class="txt empty">暂无备份</p>
      </div>

      <div class="m-card">
        <div class="lab">术语库版本</div>
        <div v-for="l in libs" :key="l.id" class="lib-row">
          <span>{{ l.name }}</span>
          <i>v{{ l.version }} · {{ l.term_count }} 条</i>
        </div>
      </div>

      <div class="m-card">
        <div class="lab">免责声明</div>
        <p class="txt">
          本软件为游戏辅助工具，翻译结果由第三方 AI 模型生成，仅供参考；内置术语库中的游戏名称与商标归各自厂商所有。请遵守所玩游戏的用户协议，因使用本软件产生的后果由使用者自行承担。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 16px;
}
.right-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.main {
  text-align: center;
  padding: 30px 20px;
}
.main .m-btn {
  margin-top: 18px;
}
.update-msg {
  font-size: 11.5px;
  color: var(--teal);
  margin-top: 8px;
}
.logo {
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: var(--accent);
  color: #161a21;
  font-size: 32px;
  font-weight: 900;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 14px;
}
h4 {
  font-size: 17px;
}
.en {
  font-size: 12px;
  color: var(--txt3);
}
.ver {
  margin-top: 14px;
  font-size: 12.5px;
  color: var(--txt2);
}
.author {
  margin-top: 4px;
  font-size: 13px;
  color: var(--accent);
  font-weight: 600;
}
.txt {
  font-size: 12.5px;
  color: var(--txt2);
  line-height: 1.7;
}
.path-label {
  font-size: 12px;
  color: var(--txt3);
  margin-top: 12px;
}
.path {
  font-size: 11.5px;
  color: var(--txt2);
  word-break: break-all;
  background: var(--card2);
  border-radius: 7px;
  padding: 7px 9px;
  margin: 4px 0 12px;
}
.m-btn {
  font-size: 12.5px;
  padding: 7px 16px;
}
.lib-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 2px;
  border-bottom: 1px solid var(--line);
  font-size: 12.5px;
}
.lib-row:last-child {
  border-bottom: none;
}
.lib-row i {
  font-style: normal;
  font-size: 11px;
  color: var(--txt3);
}
.bk-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bk-row {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--card2);
  border-radius: 8px;
  padding: 7px 9px;
}
.bk-meta {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bk-name {
  font-size: 11.5px;
  word-break: break-all;
}
.bk-meta i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--txt3);
}
.bk-row .m-btn {
  padding: 5px 10px;
  font-size: 11px;
}
.m-btn.danger {
  color: var(--danger);
  border-color: var(--danger);
}
.empty {
  margin-top: 10px;
  color: var(--txt3);
}
</style>
