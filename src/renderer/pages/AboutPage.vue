<script setup lang="ts">
import { ref, onMounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { APP_VERSION } from '../../shared/version'
import { AUTHOR_NAME, CONTACT_LINKS, type ContactLink, QQ_NUMBER } from '../../shared/links'
import type { LibView } from '../../shared/terms'
import type { BackupFile } from '../../shared/api-contract'

const dataDir = ref('')
const libs = ref<LibView[]>([])
const checking = ref(false)
const updateMsg = ref('')
const backups = ref<BackupFile[]>([])
const restoreTarget = ref('')
const resetConfirm = ref(false)
const resetMsg = ref('')

async function doReset(): Promise<void> {
  const r = await window.api.resetToDefaults()
  resetConfirm.value = false
  resetMsg.value = r.ok ? '已清空本机数据，正在重启…' : (r.message ?? '清空失败')
}

const author = AUTHOR_NAME
const contacts = CONTACT_LINKS
const qqNumber = QQ_NUMBER
const qqCopied = ref(false)
let qqTimer: ReturnType<typeof setTimeout> | null = null

// 联系方式图标：B 站 / 抖音的网址太长，界面只放图标 + 名称 + 简称
const CONTACT_ICONS: Record<string, string> = {
  github:
    'M12 2a10 10 0 00-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02a9.5 9.5 0 015 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.4.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0012 2z',
  bilibili:
    'M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 17.858 0 16.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 01-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.147.187.227h4.267a.836.836 0 01.16-.227l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.151.929.4.267.249.391.551.391.907 0 .355-.124.657-.373.906zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c0-.373.129-.689.386-.947.258-.257.574-.386.947-.386z',
  douyin:
    'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z',
  qq: 'M12 3c-2.9 0-5.2 2.2-5.2 5.1 0 .5.05 1 .13 1.45-.6.9-1.23 2.2-1.23 3.2 0 .5.2.83.47 1-.15.6-.5 1.5-1 2.3-.35.6-.1 1.35.6 1.5 1 .2 2.1-.1 2.9-.6.85.4 1.9.65 3.33.65s2.48-.25 3.33-.65c.8.5 1.9.8 2.9.6.7-.15.95-.9.6-1.5-.5-.8-.85-1.7-1-2.3.27-.17.47-.5.47-1 0-1-.63-2.3-1.23-3.2.08-.45.13-.95.13-1.45C17.2 5.2 14.9 3 12 3z'
}

function iconOf(row: ContactLink): string {
  return CONTACT_ICONS[row.key] ?? ''
}

function displayOf(row: ContactLink): string {
  if (row.key === 'qq' && qqCopied.value) return `已复制 ${qqNumber}`
  return row.display
}

async function onContact(row: ContactLink): Promise<void> {
  if (row.action === 'open' && row.url) {
    await window.api.openExternal(row.url)
    return
  }
  await copyQq()
}

async function copyQq(): Promise<void> {
  try {
    await navigator.clipboard.writeText(qqNumber)
  } catch {
    // 剪贴板不可用时仍把号码显示出来，用户可手动复制
  }
  qqCopied.value = true
  if (qqTimer) clearTimeout(qqTimer)
  qqTimer = setTimeout(() => {
    qqCopied.value = false
  }, 2200)
}

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
      <p class="author">作者：{{ author }}</p>

      <div class="contact">
        <button
          v-for="row in contacts"
          :key="row.key"
          class="contact-row"
          type="button"
          :title="row.title"
          @click="onContact(row)"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path :d="iconOf(row)" />
          </svg>
          <span class="k">{{ row.label }}</span>
          <code :class="{ copied: row.key === 'qq' && qqCopied }">{{ displayOf(row) }}</code>
          <svg v-if="row.action === 'open'" class="ext" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 4h6v6h-2V7.41l-7.29 7.3-1.42-1.42 7.3-7.29H14V4zM5 6h5v2H7v9h9v-3h2v5H5V6z" />
          </svg>
        </button>
      </div>

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
        <div class="lab">恢复默认设置</div>
        <p class="txt">
          清空本机全部数据（模型配置与 API Key、术语库、常用语、快捷键、用量统计、外观设置），回到刚安装时的空白默认状态；数据目录里的备份文件会保留，可随时还原。
        </p>
        <template v-if="resetConfirm">
          <button class="m-btn danger" @click="doReset">确认清空并重启</button>
          <button class="m-btn ghost" @click="resetConfirm = false">取消</button>
        </template>
        <button v-else class="m-btn danger" @click="resetConfirm = true">恢复默认设置</button>
        <p v-if="resetMsg" class="txt reset-msg">{{ resetMsg }}</p>
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
.contact {
  margin: 16px 0 4px;
  display: grid;
  gap: 8px;
  text-align: left;
}
.contact-row {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 9px 12px;
  cursor: pointer;
  font-family: inherit;
  color: var(--txt2);
}
.contact-row:hover {
  border-color: var(--accent-line);
}
.contact-row:hover code {
  color: var(--accent);
}
.contact-row svg {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  fill: var(--txt2);
}
.contact-row .k {
  font-size: 12px;
  color: var(--txt2);
  flex-shrink: 0;
}
.contact-row code {
  margin-left: auto;
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 11.5px;
  color: var(--txt3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-row code.copied {
  color: var(--teal);
}
.contact-row .ext {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  fill: var(--txt3);
}
.contact-row:hover .ext {
  fill: var(--accent);
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
.reset-msg {
  margin-top: 10px;
  color: var(--teal);
}
</style>
