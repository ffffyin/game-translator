<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { friendlyError } from '../../utils/message'
import { useSettingsStore } from '../../stores/settings'

/**
 * 「API 配置上云」开关（本机键 cloudSyncApi，默认关闭）。
 *
 * 默认关闭是刻意的：这一步等于把密钥明文交出去，必须是用户主动、
 * 且读完免责声明后的选择，不能因为「顺手同步」就默认带上。
 */
const settings = useSettingsStore()

const enabled = computed<boolean>(() => settings.cloudSyncApi)

/** 是否已勾选免责确认。未勾选时开关打不开 */
const ack = ref(false)
const expanded = ref(true)
const confirming = ref(false)
const busy = ref(false)
const msg = ref<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null)

// 已开启时即使 ack 复位也必须能关掉，否则用户会被自己锁在里面
const switchDisabled = computed<boolean>(() => busy.value || (!ack.value && !enabled.value))

onMounted(async () => {
  try {
    if (!settings.loaded) await settings.load()
  } catch {
    // 本机设置读不到时保持默认关闭，不阻塞账号页
  }
})

function requestToggle(): void {
  if (switchDisabled.value) return
  msg.value = null
  if (!enabled.value) {
    confirming.value = true
    return
  }
  void write(false)
}

async function write(on: boolean): Promise<void> {
  confirming.value = false
  busy.value = true
  try {
    await settings.update('cloudSyncApi', on ? 1 : 0)
    msg.value = on
      ? { kind: 'ok', text: '已开启：下次「保存到云端」会连带上传 API 配置（含密钥明文）' }
      : {
          kind: 'warn',
          text: '云端已保存的密钥不会自动删除，建议到账号页点『删除云端配置』，或去服务商重置密钥。'
        }
  } catch (e) {
    msg.value = { kind: 'error', text: friendlyError(e instanceof Error ? e.message : '') }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="m-card api-card">
    <div class="head">
      <div>
        <div class="lab">把 API 配置保存到云端</div>
        <p class="desc">默认关闭。开启后「保存到云端」会连带你填写的 API 配置一起上传，方便换电脑时直接恢复。</p>
      </div>
      <button
        type="button"
        class="sw"
        :class="{ on: enabled }"
        role="switch"
        :aria-checked="enabled"
        :disabled="switchDisabled"
        :title="!ack && !enabled ? '请先阅读并确认风险' : enabled ? '点击关闭' : '点击开启'"
        @click="requestToggle"
      >
        <span class="knob"></span>
      </button>
    </div>

    <p class="state-desc">
      <b>{{ enabled ? '当前：已开启' : '当前：已关闭' }}</b>
      <span v-if="!ack && !enabled" class="need-ack">请先阅读并确认风险</span>
    </p>

    <button type="button" class="more" @click="expanded = !expanded">
      {{ expanded ? '收起风险说明' : '查看风险说明' }}
    </button>

    <div v-if="expanded" class="risk">
      <div class="risk-t">把 API 配置保存到云端的风险</div>
      <p class="risk-p">开启后，你的 API 地址、模型名称与 <b>API 密钥明文</b> 会随配置一起上传到云端账号，用于在其他电脑上自动恢复。</p>
      <ul class="risk-list">
        <li class="risk-li">· 密钥一旦离开本机，就不再只受你一个人控制：账号密码泄露、云端服务方发生安全事件，都可能导致密钥被他人使用。</li>
        <li class="risk-li">· 由此产生的<b>额度盗刷、费用损失、第三方服务异常或账号封禁</b>，需由你自行承担，本软件不承担责任。</li>
        <li class="risk-li">· 我们仍会使用加密通道传输，但<b>无法承诺云端绝对安全</b>。</li>
      </ul>
      <p class="risk-p">建议：只在你确实需要多台电脑同步时开启，并定期更换密钥。</p>
    </div>

    <label class="ack">
      <input v-model="ack" type="checkbox" />
      我已阅读并理解上述风险，同意将 API 配置（含密钥明文）保存到云端
    </label>

    <div v-if="msg" class="msg" :class="msg.kind">{{ msg.text }}</div>

    <!-- 二次确认：开启这一步不可逆感很强，必须让用户再点一次 -->
    <div v-if="confirming" class="mask">
      <div class="dlg">
        <div class="dlg-t">确认开启云端 API 配置</div>
        <p class="dlg-p">
          开启后，下次执行「保存到云端」时，本机保存的 <b>API 地址、模型名称与 API 密钥明文</b>
          会一并上传。由此产生的额度盗刷、费用损失需由你自行承担。
        </p>
        <div class="dlg-b">
          <button type="button" class="m-btn" @click="confirming = false">取消</button>
          <button type="button" class="m-btn danger" @click="write(true)">确认开启</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}
.head > div {
  flex: 1;
  min-width: 0;
}
.lab {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 6px;
}
.desc {
  font-size: 12px;
  line-height: 1.7;
  color: var(--txt2);
}
.sw {
  flex-shrink: 0;
  width: 46px;
  height: 26px;
  border-radius: 13px;
  border: 1px solid var(--line);
  background: var(--card2);
  position: relative;
  cursor: pointer;
  padding: 0;
  margin-top: 4px;
}
.sw:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--txt3);
  transition: none;
}
.sw.on {
  background: var(--accent);
  border-color: var(--accent);
}
.sw.on .knob {
  left: 22px;
  background: #161a21;
}
.state-desc {
  margin-top: 12px;
  font-size: 12px;
  color: var(--txt2);
  display: flex;
  align-items: center;
  gap: 10px;
}
.need-ack {
  color: var(--danger);
}
.more {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  margin-top: 10px;
}
.more:hover {
  text-decoration: underline;
}
.risk {
  margin-top: 10px;
  border: 1px solid var(--danger);
  background: var(--danger-soft);
  border-radius: 8px;
  padding: 12px 14px;
}
.risk-t {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--danger);
  margin-bottom: 8px;
}
.risk-p {
  font-size: 12px;
  line-height: 1.85;
  color: var(--txt);
}
.risk-p b {
  color: var(--danger);
}
.risk-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.risk-li {
  font-size: 12px;
  line-height: 1.85;
  color: var(--txt);
}
.risk-li b {
  color: var(--danger);
}
.ack {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--txt2);
  cursor: pointer;
}
.ack input {
  width: 15px;
  height: 15px;
  margin-top: 3px;
  flex-shrink: 0;
  accent-color: var(--accent);
}
.msg {
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  margin-top: 12px;
  background: var(--card2);
  border: 1px solid var(--line);
}
.msg.ok {
  color: var(--teal);
  border-color: var(--teal);
}
.msg.warn,
.msg.error {
  color: var(--danger);
  border-color: var(--danger);
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 900;
}
.dlg {
  width: 420px;
  max-width: 90vw;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 18px 20px;
}
.dlg-t {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 10px;
}
.dlg-p {
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--txt2);
  margin-bottom: 16px;
}
.dlg-p b {
  color: var(--danger);
}
.dlg-b {
  display: flex;
  justify-content: flex-end;
  gap: 9px;
}
.m-btn.danger {
  color: var(--danger);
}
</style>
