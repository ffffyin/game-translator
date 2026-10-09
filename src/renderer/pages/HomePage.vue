<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import HotkeyModal from '../components/HotkeyModal.vue'
import HotkeyIcon from '../components/HotkeyIcon.vue'
import { useSettingsStore } from '../stores/settings'
import {
  LANGUAGES,
  TRANSLATION_STYLES,
  type AppSettings
} from '../../shared/defaults'
import type { LibView } from '../../shared/terms'
import { ACCENT_PRESETS } from '../../shared/colors'
import { FUNCTION_ACTIONS, findAction } from '../../shared/hotkeys'
import type { HotkeyEntry } from '../../shared/hotkeys'

const s = useSettingsStore()
const customHex = ref('')

const themes = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
  { value: 'system', label: '跟随系统' }
]

const hotkeys = ref<HotkeyEntry[]>([])
const libs = ref<LibView[]>([])

const testInput = ref('')
const testResult = ref('')
const testError = ref('')
const testBusy = ref(false)
// 手动测试卡走哪组方向：聊天（替换/复制翻译）还是画面（截图翻译）
const testScope = ref<'chat' | 'screen'>('chat')

async function runTest(): Promise<void> {
  const text = testInput.value.trim()
  if (!text) {
    testError.value = '请先输入要翻译的内容'
    return
  }
  testBusy.value = true
  testResult.value = ''
  testError.value = ''
  try {
    const r = await window.api.testTranslate(text, testScope.value)
    if (r.ok) testResult.value = r.translation ?? ''
    else testError.value = r.error ?? '翻译失败'
  } finally {
    testBusy.value = false
  }
}

// 两组方向天然相反（聊天写中文发英文、截图看英文翻中文），一键对调省得手动改四次
function swapDirections(): void {
  const chat = { src: s.settings.languageSource, tgt: s.settings.languageTarget }
  s.update('languageSource', s.settings.screenSource)
  s.update('languageTarget', s.settings.screenTarget)
  s.update('screenSource', chat.src)
  s.update('screenTarget', chat.tgt)
}

async function refreshLibs(): Promise<void> {
  libs.value = await window.api.termsListLibs()
}
const modalShow = ref(false)
const modalAction = ref<{ code: string; label: string }>({ code: '', label: '' })

function actionLabel(code: string): string {
  return findAction(code)?.label ?? code
}

// 快捷键列表（过滤掉常用语槽位，只展示 4 个功能动作）
const actionRows = computed(() =>
  FUNCTION_ACTIONS.map((a) => ({
    action: a,
    entry: hotkeys.value.find((h) => h.action_code === a.actionCode)
  })).filter((r) => r.entry)
)

function openModal(row: HotkeyEntry, code: string) {
  modalAction.value = { code, label: actionLabel(code) }
  modalShow.value = true
}

async function refreshHotkeys() {
  hotkeys.value = await window.api.hotkeysGetAll()
}

function set(k: keyof AppSettings, e: Event) {
  s.update(k, (e.target as HTMLSelectElement).value)
}

function langLabel(code: string): string {
  return LANGUAGES.find((l) => l.value === code)?.label ?? code
}
function applyCustomHex() {
  if (customHex.value.trim()) {
    s.setAccent(customHex.value)
    customHex.value = ''
  }
}

onMounted(() => {
  refreshHotkeys()
  refreshLibs()
})
</script>

<template>
  <PageHeader title="主页" note="选择翻译方向、游戏类型、翻译风格与外观" />

  <div class="grid">
    <div class="m-card">
      <div class="lab">翻译设置</div>
      <div class="row">
        <label>源语言</label>
        <select class="m-input" :value="s.settings.languageSource" @change="set('languageSource', $event)">
          <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>
      <div class="row">
        <label>目标语言</label>
        <select class="m-input" :value="s.settings.languageTarget" @change="set('languageTarget', $event)">
          <option v-for="l in LANGUAGES.filter((x) => x.value !== 'auto')" :key="l.value" :value="l.value">
            {{ l.label }}
          </option>
        </select>
      </div>
      <div class="swap">
        <button class="m-btn swap-btn" title="把聊天方向与画面方向对调" @click="swapDirections">
          ⇄ 互换两组方向
        </button>
      </div>
      <div class="lab sub">画面翻译方向（截图翻译）</div>
      <p class="hint">截图翻译专用；与聊天方向互不干扰</p>
      <div class="row">
        <label>画面源语言</label>
        <select class="m-input" :value="s.settings.screenSource" @change="set('screenSource', $event)">
          <option v-for="l in LANGUAGES" :key="l.value" :value="l.value">{{ l.label }}</option>
        </select>
      </div>
      <div class="row">
        <label>画面目标语言</label>
        <select class="m-input" :value="s.settings.screenTarget" @change="set('screenTarget', $event)">
          <option v-for="l in LANGUAGES.filter((x) => x.value !== 'auto')" :key="l.value" :value="l.value">
            {{ l.label }}
          </option>
        </select>
      </div>
      <div class="row">
        <label>游戏类型（术语库）</label>
        <select class="m-input" :value="s.settings.termLibrary" @change="set('termLibrary', $event)">
          <option value="general">通用（不使用游戏术语）</option>
          <option v-for="t in libs" :key="t.id" :value="t.game">{{ t.name }}</option>
        </select>
      </div>
      <div class="row">
        <label>翻译风格</label>
        <select class="m-input" :value="s.settings.translationStyle" @change="set('translationStyle', $event)">
          <option v-for="t in TRANSLATION_STYLES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </div>
    </div>

    <div class="m-card">
      <div class="lab">外观</div>
      <div class="seg">
        <button
          v-for="t in themes"
          :key="t.value"
          class="seg-btn"
          :class="{ on: s.settings.themeMode === t.value }"
          @click="s.update('themeMode', t.value)"
        >
          {{ t.label }}
        </button>
      </div>
      <div class="lab" style="margin-top: 16px">强调色</div>
      <div class="swatches">
        <button
          v-for="p in ACCENT_PRESETS"
          :key="p.value"
          class="sw"
          :class="{ on: s.settings.accentColor === p.value }"
          :style="{ background: p.value }"
          :title="p.name"
          @click="s.update('accentColor', p.value)"
        ></button>
      </div>
      <div class="custom">
        <input v-model="customHex" class="m-input" placeholder="自定义色值，如 #3CC7AB" maxlength="7" />
        <button class="m-btn accent" @click="applyCustomHex">应用</button>
      </div>
    </div>

    <div class="m-card wide">
      <div class="lab">手动测试（不进游戏即可验证当前方向 / 术语 / 风格）</div>
      <textarea
        v-model="testInput"
        class="m-input test-area"
        rows="3"
        placeholder="输入要翻译的话，例如 gg noob team"
      ></textarea>
      <div class="test-scope">
        <label for="test-scope">验证</label>
        <select id="test-scope" v-model="testScope" class="m-input">
          <option value="chat">聊天方向（{{ langLabel(s.settings.languageSource) }} → {{ langLabel(s.settings.languageTarget) }}）</option>
          <option value="screen">画面方向（{{ langLabel(s.settings.screenSource) }} → {{ langLabel(s.settings.screenTarget) }}）</option>
        </select>
      </div>
      <div class="test-actions">
        <button class="m-btn accent" :disabled="testBusy" @click="runTest">
          {{ testBusy ? '翻译中…' : '翻译' }}
        </button>
      </div>
      <div v-if="testResult" class="test-result">{{ testResult }}</div>
      <div v-if="testError" class="test-error">{{ testError }}</div>
    </div>

    <div class="m-card wide">
      <div class="lab">快捷键（点击右侧按键即可修改，支持 Ctrl / Alt / Shift 组合键）</div>
      <div class="hk-list">
        <div v-for="r in actionRows" :key="r.action.actionCode" class="hk-row">
          <div class="ic">
            <HotkeyIcon :code="r.action.actionCode" />
          </div>
          <div class="mid">
            <div class="nm">{{ r.action.label }}</div>
            <div class="ds">{{ r.action.desc }}</div>
          </div>
          <kbd @click="openModal(r.entry!, r.action.actionCode)">{{ r.entry!.accelerators }}</kbd>
        </div>
      </div>
    </div>
  </div>

  <HotkeyModal
    :show="modalShow"
    :action-code="modalAction.code"
    :label="modalAction.label"
    @close="modalShow = false"
    @saved="modalShow = false; refreshHotkeys()"
  />
</template>

<style scoped>
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
.wide {
  grid-column: 1 / -1;
}
.test-area {
  width: 100%;
  resize: vertical;
  margin-top: 10px;
  font-family: inherit;
}
.test-actions {
  margin-top: 10px;
}
.test-result {
  margin-top: 10px;
  background: var(--teal-soft);
  border: 1px solid var(--teal);
  color: var(--txt);
  border-radius: 9px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.test-error {
  margin-top: 10px;
  background: var(--danger-soft);
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: 9px;
  padding: 10px 12px;
  font-size: 12.5px;
}
.row {
  display: grid;
  grid-template-columns: 120px 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.row label {
  font-size: 12.5px;
  color: var(--txt2);
}
.seg {
  display: flex;
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 3px;
}
.seg-btn {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--txt2);
  padding: 7px 0;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer;
}
.seg-btn.on {
  background: var(--accent);
  color: #1a1408;
  font-weight: 600;
}
/* 夹在两组方向之间：左对齐、跟着 .row 的左列走，别撑满整行抢视线 */
.swap {
  display: flex;
  justify-content: flex-start;
  margin: 0 0 13px;
}
.swap-btn {
  font-size: 12px;
  padding: 6px 14px;
  color: var(--txt2);
}
.lab.sub {
  margin-top: 4px;
  margin-bottom: 6px;
  padding-top: 13px;
  border-top: 1px dashed var(--line);
}
.hint {
  margin: 0 0 12px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--txt3);
}
.test-scope {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 12.5px;
  color: var(--txt2);
}
.test-scope select {
  width: auto;
  padding: 6px 10px;
  font-size: 12.5px;
}
.sw {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
}
.sw.on {
  border-color: var(--txt);
}
.custom {
  display: flex;
  gap: 9px;
  margin-top: 14px;
}
.hk-list {
  display: grid;
  gap: 9px;
}
.hk-row {
  display: flex;
  align-items: center;
  gap: 13px;
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 11px 15px;
}
.hk-row .ic {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.hk-row .ic svg {
  width: 16px;
  height: 16px;
  stroke: var(--accent);
}
.hk-row .mid {
  flex: 1;
  min-width: 0;
}
.hk-row .nm {
  font-size: 12.8px;
  color: var(--txt);
  line-height: 1.5;
}
.hk-row .ds {
  font-size: 11px;
  color: var(--txt3);
  line-height: 1.5;
}
kbd {
  font-family: ui-monospace, Consolas, 'Courier New', monospace;
  font-size: 11.5px;
  background: var(--side);
  border: 1px solid var(--line);
  border-bottom-width: 2px;
  border-radius: 7px;
  padding: 5px 11px;
  color: var(--accent);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
}
kbd:hover {
  border-color: var(--accent-line);
}
</style>
