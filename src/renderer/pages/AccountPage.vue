<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import type { CloudStatus, CloudSummary } from '../../shared/cloud'

// 前端先挡一道：格式不对就不用等一次 IPC 往返才看到提示。
// 主进程侧还有同样的校验 —— IPC 谁都能调，那道才是真正的闸门。
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const status = ref<CloudStatus | null>(null)
const local = ref<CloudSummary | null>(null)

const email = ref('')
const code = ref('')
const verificationId = ref('')
const isExistingUser = ref(false)

const sending = ref(false)
const verifying = ref(false)
const working = ref(false)
const msg = ref<{ ok: boolean; text: string } | null>(null)
const cooldown = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

// 覆盖本机是不可逆的，二次点击才真正执行
const pullArmed = ref(false)
const removeArmed = ref(false)

function setMsg(ok: boolean, text: string): void {
  msg.value = { ok, text }
}

async function refresh(): Promise<void> {
  status.value = await window.api.cloudStatus()
  local.value = await window.api.cloudLocalSummary()
}

async function sendCode(): Promise<void> {
  if (sending.value || cooldown.value > 0) return
  const mail = email.value.trim()
  if (!EMAIL_RE.test(mail)) {
    setMsg(false, '请输入正确的邮箱地址')
    return
  }
  sending.value = true
  setMsg(true, '正在发送验证码…')
  try {
    const r = await window.api.cloudSendOtp(email.value)
    if (!r.ok) {
      setMsg(false, r.message)
      return
    }
    verificationId.value = r.verificationId
    isExistingUser.value = r.isExistingUser
    setMsg(true, r.message)
    startCooldown()
  } finally {
    sending.value = false
  }
}

async function login(): Promise<void> {
  if (verifying.value) return
  verifying.value = true
  try {
    const r = await window.api.cloudVerifyOtp({
      email: email.value,
      verificationId: verificationId.value,
      token: code.value,
      isExistingUser: isExistingUser.value
    })
    status.value = r.status
    setMsg(r.ok, r.message)
    if (r.ok) {
      code.value = ''
      verificationId.value = ''
      await refresh()
    }
  } finally {
    verifying.value = false
  }
}

async function signOut(): Promise<void> {
  working.value = true
  try {
    const r = await window.api.cloudSignOut()
    setMsg(r.ok, r.message)
    await refresh()
  } finally {
    working.value = false
  }
}

async function push(): Promise<void> {
  working.value = true
  setMsg(true, '正在保存到云端…')
  try {
    const r = await window.api.cloudPush()
    setMsg(r.ok, r.message)
    await refresh()
  } finally {
    working.value = false
  }
}

async function pull(): Promise<void> {
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
    setMsg(r.ok, r.message)
    await refresh()
  } finally {
    working.value = false
  }
}

async function removeRemote(): Promise<void> {
  if (!removeArmed.value) {
    removeArmed.value = true
    setMsg(false, '再点一次确认删除云端保存的配置（本机数据不会变动）。')
    return
  }
  removeArmed.value = false
  working.value = true
  try {
    const r = await window.api.cloudRemoveRemote()
    setMsg(r.ok, r.message)
    await refresh()
  } finally {
    working.value = false
  }
}

function startCooldown(): void {
  cooldown.value = 60
  if (timer) clearInterval(timer)
  timer = setInterval(() => {
    cooldown.value -= 1
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }, 1000)
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

onMounted(async () => {
  await refresh()
})

onUnmounted(() => {
  if (timer) clearInterval(timer)
  timer = null
})
</script>

<template>
  <PageHeader
    title="账号与云同步"
    note="可选功能：不登录也能使用全部本地功能，登录只是为了让配置多一台设备可用"
  />

  <div class="wrap">
    <section v-if="!status" class="m-card">
      <p class="loading">正在读取账号状态…</p>
    </section>

    <!-- 未登录：邮箱验证码登录（不设密码，本机不保存任何口令） -->
    <section v-else-if="!status.signedIn" class="m-card">
      <div class="lab">邮箱验证码登录</div>
      <p class="tip">
        输入邮箱接收验证码，验证通过即登录；首次使用的邮箱会自动创建账号。全程不设密码，本机也不保存任何口令。
      </p>

      <div class="f-row">
        <label>邮箱</label>
        <div class="inline">
          <input v-model="email" class="m-input" placeholder="you@example.com" autocomplete="off" />
          <button class="m-btn" :disabled="sending || cooldown > 0" @click="sendCode">
            {{ cooldown > 0 ? `${cooldown}s 后重发` : sending ? '发送中…' : '获取验证码' }}
          </button>
        </div>
      </div>

      <div class="f-row">
        <label>验证码</label>
        <div class="inline">
          <input v-model="code" class="m-input code" placeholder="邮箱里收到的 6 位数字" autocomplete="one-time-code" />
          <button class="m-btn accent" :disabled="verifying || !verificationId" @click="login">
            {{ verifying ? '登录中…' : '登录 / 注册' }}
          </button>
        </div>
      </div>

      <p v-if="!verificationId" class="tip dim">先点「获取验证码」，收到后再填入上面的输入框。</p>
      <p v-if="status.message && !status.signedIn" class="tip dim">{{ status.message }}</p>
    </section>

    <!-- 已登录 -->
    <section v-else class="m-card">
      <div class="lab">已登录</div>
      <div class="who">
        <span class="avatar">{{ (status.email ?? status.userId ?? '?').slice(0, 1).toUpperCase() }}</span>
        <div>
          <b>{{ status.email ?? status.phone ?? '已登录用户' }}</b>
          <span class="sub">ID：{{ status.userId ?? '-' }}</span>
        </div>
        <i v-if="!status.online" class="badge warn">离线</i>
      </div>

      <div class="kv">
        <span>云端上次保存</span>
        <b>{{ timeText(status.remoteUpdatedAt) }}</b>
      </div>
      <div class="kv">
        <span>云端内容</span>
        <b>{{ summaryText(status.remoteSummary) }}</b>
      </div>
      <div class="kv">
        <span>本机内容</span>
        <b>{{ summaryText(local) }}</b>
      </div>

      <div class="actions">
        <button class="m-btn accent" :disabled="working" @click="push">保存到云端</button>
        <button class="m-btn" :class="{ danger: pullArmed }" :disabled="working" @click="pull">
          {{ pullArmed ? '再点一次确认覆盖' : '从云端恢复' }}
        </button>
        <button class="m-btn danger" :disabled="working" @click="signOut">退出登录</button>
        <button class="m-btn" :class="{ danger: removeArmed }" :disabled="working" @click="removeRemote">
          {{ removeArmed ? '再点一次确认删除' : '删除云端配置' }}
        </button>
      </div>
      <p v-if="status.message" class="tip dim">{{ status.message }}</p>
    </section>

    <div v-if="msg" class="msg" :class="{ ok: msg.ok, error: !msg.ok }">{{ msg.text }}</div>

    <section class="m-card note-card">
      <div class="lab">同步范围</div>
      <ul class="list">
        <li><b>会同步</b>：语言方向、翻译风格、OCR 通道、主题与配色、常用语开关、术语库更新地址</li>
        <li><b>会同步</b>：你自建的术语库（不含软件内置库）、全部常用语分页与条目</li>
        <li><b>不同步</b>：模型地址与 API Key —— 它们用本机 DPAPI 加密，换机器本就解不开，也绝不会上传</li>
        <li><b>不同步</b>：用量统计、备份文件、快捷键绑定（与本机强相关）</li>
      </ul>
      <p class="tip dim">
        同步是整包覆盖，不是合并：保存到云端 = 用本机覆盖云端；从云端恢复 = 用云端覆盖本机（覆盖前会自动做一份本地备份）。
      </p>
    </section>
  </div>
</template>

<style scoped>
.wrap {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 720px;
}
.lab {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 10px;
}
.loading {
  font-size: 12.5px;
  color: var(--txt3);
}
.tip {
  font-size: 12px;
  line-height: 1.7;
  color: var(--txt2);
  margin-bottom: 12px;
}
.tip.dim {
  color: var(--txt3);
  margin-bottom: 0;
  margin-top: 8px;
}
.f-row {
  display: grid;
  grid-template-columns: 78px 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.f-row label {
  font-size: 12.5px;
  color: var(--txt2);
}
.inline {
  display: flex;
  gap: 9px;
}
.inline .m-input {
  flex: 1;
}
.code {
  letter-spacing: 3px;
}
.who {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
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
}
.who b {
  font-size: 13.5px;
  display: block;
}
.who .sub {
  font-size: 11px;
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
.list {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  line-height: 1.9;
  color: var(--txt2);
}
.list b {
  color: var(--txt);
}
.note-card .tip {
  margin-top: 10px;
  margin-bottom: 0;
}
.m-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.m-btn.danger {
  color: var(--danger);
}
</style>
