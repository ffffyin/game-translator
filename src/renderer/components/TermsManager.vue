<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { LibView, TermView } from '../../shared/terms'

const libs = ref<LibView[]>([])
const terms = ref<TermView[]>([])
const currentLibId = ref<number | null>(null)
const search = ref('')

const creatingLib = ref(false)
const newLibName = ref('')

const formShow = ref(false)
const editingId = ref<number | null>(null)
const fSource = ref('')
const fTarget = ref('')
const fTag = ref('')
const formError = ref('')

const confirmTermId = ref<number | null>(null)
const confirmLib = ref(false)
const loadError = ref('')
const ioMessage = ref('')
const updateUrl = ref('')
const updateResult = ref('')
const pendingUpdates = ref<Array<{ name: string; currentVersion: string; newVersion: string }>>([])

const currentLib = computed(() => libs.value.find((l) => l.id === currentLibId.value) ?? null)

async function loadLibs(selectId?: number): Promise<void> {
  libs.value = await window.api.termsListLibs()
  if (libs.value.length) {
    currentLibId.value = selectId ?? currentLibId.value ?? libs.value[0].id
    await loadTerms()
  } else {
    currentLibId.value = null
    terms.value = []
  }
}

async function loadTerms(): Promise<void> {
  if (currentLibId.value == null) return
  terms.value = await window.api.termsListTerms(currentLibId.value, search.value)
}

let searchTimer: ReturnType<typeof setTimeout> | undefined
function onSearch(): void {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(loadTerms, 200)
}

function selectLib(id: number): void {
  confirmLib.value = false
  currentLibId.value = id
  loadTerms()
}

async function submitNewLib(): Promise<void> {
  const name = newLibName.value.trim()
  if (!name) return
  try {
    const id = await window.api.termsCreateLib({ name })
    creatingLib.value = false
    newLibName.value = ''
    await loadLibs(id)
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '创建失败'
  }
}

async function deleteCurrentLib(): Promise<void> {
  if (currentLibId.value == null) return
  try {
    await window.api.termsDeleteLib(currentLibId.value)
    confirmLib.value = false
    await loadLibs()
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : '删除失败'
  }
}

function openAddForm(): void {
  editingId.value = null
  fSource.value = ''
  fTarget.value = ''
  fTag.value = ''
  formError.value = ''
  formShow.value = true
}

function openEditForm(t: TermView): void {
  editingId.value = t.id
  fSource.value = t.source_text
  fTarget.value = t.target_text
  fTag.value = t.tag ?? ''
  formError.value = ''
  formShow.value = true
}

async function submitForm(): Promise<void> {
  if (!fSource.value.trim() || !fTarget.value.trim()) {
    formError.value = '原文和译文都不能为空'
    return
  }
  const input = {
    source_text: fSource.value.trim(),
    target_text: fTarget.value.trim(),
    tag: fTag.value.trim() || undefined
  }
  try {
    if (editingId.value == null) {
      if (currentLibId.value == null) throw new Error('请先选择术语库')
      await window.api.termsCreateTerm(currentLibId.value, input)
    } else {
      await window.api.termsUpdateTerm(editingId.value, input)
    }
    formShow.value = false
    await loadTerms()
  } catch (err) {
    formError.value = err instanceof Error ? err.message : '保存失败'
  }
}

async function confirmDeleteTerm(): Promise<void> {
  if (confirmTermId.value == null) return
  await window.api.termsDeleteTerm(confirmTermId.value)
  confirmTermId.value = null
  await loadTerms()
}

async function exportLib(): Promise<void> {
  if (currentLibId.value == null) return
  const r = await window.api.termsExportLib(currentLibId.value)
  ioMessage.value = r.message
}

async function importLib(): Promise<void> {
  const r = await window.api.termsImportLib()
  ioMessage.value = r.message
  if (r.ok) await loadLibs()
}

async function checkUpdates(): Promise<void> {
  pendingUpdates.value = []
  updateResult.value = ''
  const r = await window.api.termsCheckUpdates(updateUrl.value.trim())
  if (!r.ok) {
    updateResult.value = r.message ?? '检查失败'
    return
  }
  pendingUpdates.value = (r.updates ?? []) as typeof pendingUpdates.value
  updateResult.value = pendingUpdates.value.length
    ? `发现 ${pendingUpdates.value.length} 个可更新术语库`
    : '所有术语库均为最新版本'
}

async function doApplyUpdates(): Promise<void> {
  const r = await window.api.termsApplyUpdates(updateUrl.value.trim())
  updateResult.value = r.message
  pendingUpdates.value = []
  if (r.ok) await loadLibs()
}

async function loadUpdateUrl(): Promise<void> {
  const all = await window.api.settingsGetAll()
  updateUrl.value = all.termUpdateUrl ?? ''
}

async function saveUpdateUrl(): Promise<void> {
  await window.api.settingsSet('termUpdateUrl', updateUrl.value.trim())
  ioMessage.value = '更新源地址已保存'
}

onMounted(() => {
  loadLibs().catch((e) => (loadError.value = String(e)))
  loadUpdateUrl()
})
</script>

<template>
  <div class="terms">
    <div class="bar">
      <div class="chips">
        <button
          v-for="l in libs"
          :key="l.id"
          class="chip"
          :class="{ on: l.id === currentLibId }"
          @click="selectLib(l.id)"
        >
          {{ l.name }}
          <i v-if="l.is_builtin === 1">内置</i>
        </button>
        <button v-if="!creatingLib" class="chip ghost" @click="creatingLib = true">＋ 新建库</button>
        <button class="chip ghost" @click="importLib">导入库</button>
      </div>
    </div>

    <div v-if="creatingLib" class="new-lib">
      <input v-model="newLibName" class="m-input" placeholder="自定义术语库名称，如：瓦罗兰特" maxlength="30" />
      <button class="m-btn accent" @click="submitNewLib">创建</button>
      <button class="m-btn" @click="creatingLib = false">取消</button>
    </div>

    <div v-if="currentLib" class="lib-meta">
      <span class="ver">版本 {{ currentLib.version || '0' }}</span>
      <span class="cnt">共 {{ terms.length }} 条（当前视图）</span>
      <button class="link" @click="exportLib">导出该库</button>
      <template v-if="currentLib.is_builtin === 0">
        <button v-if="!confirmLib" class="link danger" @click="confirmLib = true">删除该库</button>
        <template v-else>
          <span class="warn">确认删除整个词库？</span>
          <button class="link danger" @click="deleteCurrentLib">确认删除</button>
          <button class="link" @click="confirmLib = false">取消</button>
        </template>
      </template>
    </div>

    <div class="tools">
      <input v-model="search" class="m-input search" placeholder="搜索原文或译文" @input="onSearch" />
      <button class="m-btn accent" :disabled="!currentLib" @click="openAddForm">＋ 添加词条</button>
    </div>

    <div v-if="formShow" class="form">
      <div class="form-title">{{ editingId == null ? '添加词条' : '编辑词条' }}</div>
      <div class="form-grid">
        <input v-model="fSource" class="m-input" placeholder="原文（如 gank）" />
        <input v-model="fTarget" class="m-input" placeholder="译文（如 抓人）" />
        <input v-model="fTag" class="m-input" placeholder="类型，可选（如 战术）" maxlength="10" />
      </div>
      <div v-if="formError" class="form-err">{{ formError }}</div>
      <div class="form-actions">
        <button class="m-btn accent" @click="submitForm">保存</button>
        <button class="m-btn" @click="formShow = false">取消</button>
      </div>
    </div>

    <table class="t-table">
      <colgroup>
        <col style="width: 30%" />
        <col style="width: 30%" />
        <col style="width: 16%" />
        <col style="width: 24%" />
      </colgroup>
      <thead>
        <tr>
          <th>原文</th>
          <th>译文</th>
          <th>类型</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in terms" :key="t.id">
          <td>{{ t.source_text }}</td>
          <td>{{ t.target_text }}</td>
          <td>
            <span v-if="t.tag" class="tag">{{ t.tag }}</span>
            <span v-else class="dim">—</span>
          </td>
          <td class="ops">
            <template v-if="confirmTermId === t.id">
              <span class="warn">确认？</span>
              <button class="link danger" @click="confirmDeleteTerm">删除</button>
              <button class="link" @click="confirmTermId = null">取消</button>
            </template>
            <template v-else>
              <button class="link" @click="openEditForm(t)">编辑</button>
              <button class="link danger" @click="confirmTermId = t.id">删除</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!terms.length" class="empty">没有匹配的词条，可点击「添加词条」新增</div>
    <div v-if="ioMessage" class="io-msg">{{ ioMessage }}</div>
    <div v-if="loadError" class="form-err">{{ loadError }}</div>

    <div class="update-box">
      <div class="form-title">术语库联网更新</div>
      <div class="tools">
        <input
          v-model="updateUrl"
          class="m-input search"
          placeholder="更新清单地址（https://…/manifest.json）"
          @change="saveUpdateUrl"
        />
        <button class="m-btn" @click="checkUpdates">检查更新</button>
        <button class="m-btn accent" @click="doApplyUpdates">一键更新</button>
      </div>
      <div v-if="pendingUpdates.length" class="upd-list">
        <div v-for="u in pendingUpdates" :key="u.name" class="upd-row">
          <b>{{ u.name }}</b>
          <span>{{ u.currentVersion || '0' }} → {{ u.newVersion }}</span>
        </div>
      </div>
      <div v-if="updateResult" class="io-msg">{{ updateResult }}</div>
    </div>
  </div>
</template>

<style scoped>
.bar {
  margin-bottom: 12px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--card2);
  border: 1px solid var(--line);
  color: var(--txt2);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12.5px;
  cursor: pointer;
}
.chip i {
  font-style: normal;
  font-size: 10px;
  color: var(--txt3);
}
.chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-soft);
}
.chip.ghost {
  border-style: dashed;
}
.new-lib {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.lib-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11.5px;
  color: var(--txt3);
  margin-bottom: 10px;
}
.tools {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.search {
  flex: 1;
}
.form {
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.form-title {
  font-size: 12.5px;
  color: var(--txt2);
  margin-bottom: 9px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 9px;
}
.form-actions {
  margin-top: 10px;
  display: flex;
  gap: 8px;
}
.form-err {
  color: var(--danger);
  font-size: 11.5px;
  margin-top: 8px;
}
.t-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12.5px;
}
.t-table th {
  text-align: left;
  font-weight: 600;
  color: var(--txt3);
  font-size: 11.5px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--line);
}
.t-table td {
  padding: 8px;
  border-bottom: 1px solid var(--line);
  color: var(--txt);
  word-break: break-word;
}
.tag {
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--txt2);
}
.dim {
  color: var(--txt3);
}
.ops {
  white-space: nowrap;
}
.link {
  background: none;
  border: none;
  color: var(--teal);
  font-size: 11.5px;
  cursor: pointer;
  padding: 0 3px;
}
.link.danger {
  color: var(--danger);
}
.warn {
  color: var(--danger);
  font-size: 11px;
}
.empty {
  text-align: center;
  color: var(--txt3);
  font-size: 12.5px;
  padding: 22px 0;
}
.io-msg {
  color: var(--teal);
  font-size: 11.5px;
  margin-top: 8px;
}
.update-box {
  margin-top: 16px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.upd-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.upd-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--txt2);
}
.upd-row b {
  color: var(--txt);
  font-weight: 600;
}
</style>
