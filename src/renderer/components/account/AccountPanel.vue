<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AccountChangePasswordForm from './AccountChangePasswordForm.vue'
import CloudApiSyncCard from './CloudApiSyncCard.vue'
import { maskEmail } from '../../../shared/account'
import type { CloudSummary } from '../../../shared/cloud'
import { friendlyError, friendlyOk } from '../../utils/message'
import { useAuthStore } from '../../stores/auth'

/** 已登录面板：账号卡 + 修改密码 + 云端同步 + 退出登录 */
const auth = useAuthStore()

const local = ref<CloudSummary | null>(null)
const working = ref(false)
const msg = ref<{ ok: boolean; text: string } | null>(null)

// 覆盖本机 / 删除云端都是不可逆操作，第一次点击只是「上膛」
const pullArmed = ref(false)
const removeArmed = ref(false)
const signOutArmed = ref(false)
const changing = ref(false)

const nickname = computed<string>(() => {
  const name = auth.accountName.trim()
  if (name) return name
  const mail = auth.email
  return mail.includes('@') ? mail.slice(0, mail.indexOf('@')) : '未命名用户'
})

const masked = computed<string>(() => (auth.email ? maskEmail(auth.email) : '未绑定邮箱'))

const avatarText = computed<string>(() => nickname.value.slice(0, 1).toUpperCase())

function setMsg(ok: boolean, text: string): void {
  msg.value = { ok, text }
}

function summaryText(s: CloudSummary | null | undefined): string {
  if (!s) return '暂无数据'
  return `术语库 ${s.termLibs} 个 / 词条 ${s.terms} 条 · 常用语分页 ${s.phrasePages} 页 / ${s.phrases} 条`
}

function timeText(iso: string | null): string {
  if (!iso) return '从未保存'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '未知'
  return d.toLocaleString('zh-CN', { hour12: false })
}

/** 云端读写需要网络；本地会话依然有效，所以这里只是拦操作，不碰登录态 */
function offlineBlocked(): boolean {
  if (auth.online) return false
  setMsg(false, '网络不可用，暂时无法使用云端同步')
  return true
}

async function refreshLocal(): Promise<void> {
  try {
    local.value = await window.api.cloudLocalSummary()
  } catch {
    local.value = null
  }
}

async function afterCloudAction(): Promise<void> {
  await auth.refresh()
  await refreshLocal()
}

async function push(): Promise<void> {
  if (working.value) return
  if (offlineBlocked()) return
  working.value = true
  setMsg(true, '正在保存到云端…')
  try {
    const r = await window.api.cloudPush()
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    setMsg(true, friendlyOk(r.message, '已保存到云端'))
    await afterCloudAction()
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    working.value = false
  }
}

async function pull(): Promise<void> {
  if (working.value) return
  if (offlineBlocked()) return
  if (!pullArmed.value) {
    pullArmed.value = true
    setMsg(false, '再用云端覆盖本机？本机当前的术语库与常用语会被替换（覆盖前会自动备份）。再点一次确认。')
    return
  }
  pullArmed.value = false
  working.value = true
  setMsg(true, '正在从云端恢复…')
  try {
    const r = await window.api.cloudPull()
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    setMsg(true, friendlyOk(r.message, '已从云端恢复'))
    await afterCloudAction()
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    working.value = false
  }
}

async function removeRemote(): Promise<void> {
  if (working.value) return
  if (offlineBlocked()) return
  if (!removeArmed.value) {
    removeArmed.value = true
    setMsg(false, '再点一次确认删除云端保存的配置（本机数据不会变动）。')
    return
  }
  removeArmed.value = false
  working.value = true
  try {
    const r = await window.api.cloudRemoveRemote()
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    setMsg(true, friendlyOk(r.message, '已删除云端配置'))
    await afterCloudAction()
  } catch (e) {
    setMsg(false, friendlyError(e instanceof Error ? e.message : ''))
  } finally {
    working.value = false
  }
}

async function signOut(): Promise<void> {
  if (working.value) return
  if (!signOutArmed.value) {
    signOutArmed.value = true
    setMsg(false, '退出后本机将回到未登录状态，需要重新输入邮箱密码。再点一次确认。')
    return
  }
  signOutArmed.value = false
  working.value = true
  try {
    const r = await auth.signOut()
    if (!r.ok) {
      setMsg(false, friendlyError(r.message))
      return
    }
    // 登录态由 App.vue 统一监听并跳转 /auth，这里不重复处理路由
    changing.value = false
    msg.value = null
  } finally {
    working.value = false
  }
}

onMounted(refreshLocal)
</script>

<template>
  <div class="wrap">
    <section class="m-card">
      <div class="lab">账号</div>
      <div class="who">
        <span class="avatar">{{ avatarText }}</span>
        <div class="who-main">
          <b>{{ nickname }}</b>
          <span class="sub">{{ masked }}</span>
        </div>
        <i v-if="!auth.online" class="badge warn">离线</i>
      </div>

      <div class="kv">
        <span>云端上次保存</span>
        <b>{{ timeText(auth.remoteUpdatedAt) }}</b>
      </div>
      <div class="kv">
        <span>云端内容</span>
        <b>{{ summaryText(auth.remoteSummary) }}</b>
      </div>
      <div class="kv">
        <span>本机内容</span>
        <b>{{ summaryText(local) }}</b>
      </div>

      <div class="actions">
        <button class="m-btn" @click="changing = !changing">
          {{ changing ? '收起修改密码' : '修改密码' }}
        </button>
        <button class="m-btn danger" :disabled="working" @click="signOut">
          {{ signOutArmed ? '再点一次确认退出' : '退出登录' }}
        </button>
      </div>

      <div v-if="changing" class="chg-box">
        <AccountChangePasswordForm @done="changing = false" @cancel="changing = false" />
      </div>
    </section>

    <section class="m-card">
      <div class="lab">云端同步</div>
      <p class="tip">
        同步是整包覆盖，不是合并：保存 = 用本机覆盖云端；恢复 = 用云端覆盖本机（恢复前会自动做一份本地备份）。
      </p>
      <p v-if="!auth.online" class="tip dim">当前网络不可用，云端读写已暂停；本地功能不受影响。</p>

      <div class="actions">
        <button class="m-btn accent" :disabled="working" @click="push">保存到云端</button>
        <button class="m-btn" :class="{ danger: pullArmed }" :disabled="working" @click="pull">
          {{ pullArmed ? '再点一次确认覆盖' : '从云端恢复' }}
        </button>
        <button class="m-btn" :class="{ danger: removeArmed }" :disabled="working" @click="removeRemote">
          {{ removeArmed ? '再点一次确认删除' : '删除云端配置' }}
        </button>
      </div>
    </section>

    <CloudApiSyncCard />

    <div v-if="msg" class="msg" :class="msg.ok ? 'ok' : 'error'">{{ msg.text }}</div>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lab {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
}
.tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--txt2);
  margin-bottom: 12px;
}
.tip.dim {
  color: var(--txt3);
}
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  flex-shrink: 0;
}
.who-main {
  min-width: 0;
}
.who-main b {
  font-size: 13.5px;
  display: block;
}
.who-main .sub {
  font-size: 11.5px;
  color: var(--txt3);
}
.badge {
  font-style: normal;
  font-size: 10px;
  border-radius: 5px;
  padding: 1px 7px;
  margin-left: auto;
  border: 1px solid var(--txt3);
  color: var(--txt3);
}
.badge.warn {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-soft);
}
.kv {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  padding: 8px 0;
  border-top: 1px dashed var(--line);
  color: var(--txt3);
}
.kv b {
  color: var(--txt2);
  font-weight: 500;
  text-align: right;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 14px;
}
.chg-box {
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.msg {
  border-radius: 8px;
  padding: 9px 13px;
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--card2);
  border: 1px solid var(--line);
}
.msg.ok {
  color: var(--teal);
  border-color: var(--teal);
}
.msg.error {
  color: var(--danger);
  border-color: var(--danger);
}
.m-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.m-btn.danger {
  color: var(--danger);
}
</style>
