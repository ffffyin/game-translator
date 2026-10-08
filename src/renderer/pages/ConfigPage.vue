<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import { useModelsStore } from '../stores/models'
import { PROVIDER_TEMPLATES, type ProviderTemplate } from '../../shared/providers'
import type { ModelConfigInput, ModelConfigView } from '../../shared/model'

const models = useModelsStore()

const editingId = ref<number | null>(null)
const testing = ref(false)
const saving = ref(false)
const testMsg = ref<{ ok: boolean; message: string } | null>(null)

interface FormState {
  name: string
  provider: string
  base_url: string
  api_key: string
  text_model: string
  vision_enabled: boolean
  vision_model: string
  params_json: string
  hasKey: boolean
}

function emptyForm(): FormState {
  return {
    name: '',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    api_key: '',
    text_model: 'gpt-4o-mini',
    vision_enabled: false,
    vision_model: '',
    params_json: '',
    hasKey: false
  }
}

const form = ref<FormState>(emptyForm())

const currentTemplate = computed<ProviderTemplate | undefined>(() =>
  PROVIDER_TEMPLATES.find((p) => p.provider === form.value.provider)
)

function pickProvider(provider: string) {
  const t = PROVIDER_TEMPLATES.find((p) => p.provider === provider)
  form.value.provider = provider
  if (t) {
    form.value.base_url = t.baseUrl
    if (t.textModels.length > 0) form.value.text_model = t.textModels[0]
  }
}

function startNew() {
  editingId.value = null
  form.value = emptyForm()
  testMsg.value = null
}

async function edit(item: ModelConfigView) {
  editingId.value = item.id
  testMsg.value = null
  form.value = {
    name: item.name,
    provider: item.provider,
    base_url: item.base_url,
    api_key: '',
    text_model: item.text_model,
    vision_enabled: item.vision_enabled === 1,
    vision_model: item.vision_model ?? '',
    params_json: item.params_json ?? '',
    hasKey: item.hasKey
  }
}

function validate(): string | null {
  if (!form.value.name.trim()) return '请填写配置名称'
  if (!form.value.base_url.trim()) return '请填写 API 地址'
  if (!form.value.text_model.trim()) return '请填写文本模型名'
  if (editingId.value === null && !form.value.api_key) return '请填写 API Key'
  if (form.value.params_json.trim()) {
    try {
      JSON.parse(form.value.params_json)
    } catch {
      return '附加参数不是合法 JSON'
    }
  }
  return null
}

function toInput(): ModelConfigInput {
  return {
    name: form.value.name.trim(),
    provider: form.value.provider,
    base_url: form.value.base_url.trim(),
    api_key: form.value.api_key,
    text_model: form.value.text_model.trim(),
    vision_enabled: form.value.vision_enabled ? 1 : 0,
    vision_model: form.value.vision_model || undefined,
    params_json: form.value.params_json.trim() || undefined
  }
}

async function save() {
  const err = validate()
  if (err) {
    testMsg.value = { ok: false, message: err }
    return
  }
  saving.value = true
  try {
    if (editingId.value === null) {
      const created = await window.api.modelsCreate(toInput())
      editingId.value = created.id
    } else {
      await window.api.modelsUpdate(editingId.value, toInput())
    }
    await models.refresh()
    testMsg.value = { ok: true, message: '已保存' }
  } catch (e) {
    testMsg.value = { ok: false, message: e instanceof Error ? e.message : '保存失败' }
  } finally {
    saving.value = false
  }
}

async function runTest() {
  if (editingId.value === null) {
    testMsg.value = { ok: false, message: '请先保存配置，再测试连接' }
    return
  }
  testing.value = true
  testMsg.value = null
  try {
    testMsg.value = await window.api.modelsTest(editingId.value)
  } finally {
    testing.value = false
  }
}

async function makeDefault() {
  if (editingId.value === null) return
  await window.api.modelsSetDefault(editingId.value)
  await models.refresh()
  testMsg.value = { ok: true, message: '已设为默认模型' }
}

async function remove() {
  if (editingId.value === null) return
  await window.api.modelsDelete(editingId.value)
  await models.refresh()
  startNew()
}

onMounted(async () => {
  await models.refresh()
  if (models.items.length === 0) startNew()
  else edit(models.items[0])
})
</script>

<template>
  <PageHeader title="AI 模型配置" note="选择厂商模板或完全自定义，Key 仅保存在本机并加密" />

  <div class="layout">
    <div class="left">
      <button class="m-btn accent new-btn" @click="startNew">+ 新建配置</button>
      <div
        v-for="m in models.items"
        :key="m.id"
        class="model-item"
        :class="{ on: editingId === m.id }"
        @click="edit(m)"
      >
        <div class="top">
          <b>{{ m.name }}</b>
          <i v-if="m.is_default === 1" class="badge">默认</i>
        </div>
        <span class="sub">{{ m.text_model }}</span>
      </div>
      <p v-if="models.items.length === 0" class="empty">还没有配置，点击上方新建</p>
    </div>

    <div class="right m-card">
      <div class="lab">{{ editingId === null ? '新建模型配置' : '编辑模型配置' }}</div>

      <div class="f-row">
        <label>厂商模板</label>
        <select class="m-input" :value="form.provider"
          @change="pickProvider(($event.target as HTMLSelectElement).value)">
          <option v-for="p in PROVIDER_TEMPLATES" :key="p.provider" :value="p.provider">{{ p.name }}</option>
        </select>
      </div>

      <div class="f-row">
        <label>配置名称</label>
        <input v-model="form.name" class="m-input" placeholder="例如：我的 DeepSeek" />
      </div>

      <div class="f-row">
        <label>API 地址</label>
        <input v-model="form.base_url" class="m-input" placeholder="https://..." />
      </div>

      <div class="f-row">
        <label>API Key</label>
        <input v-model="form.api_key" type="password" class="m-input"
          :placeholder="form.hasKey ? '已配置，留空表示不修改' : '请输入 API Key'" autocomplete="off" />
      </div>

      <div class="f-row">
        <label>文本模型</label>
        <input v-model="form.text_model" class="m-input" list="model-list" placeholder="模型名" />
        <datalist id="model-list">
          <option v-for="m in currentTemplate?.textModels ?? []" :key="m" :value="m"></option>
        </datalist>
      </div>

      <div class="f-row check">
        <label>视觉能力（截图翻译用）</label>
        <input v-model="form.vision_enabled" type="checkbox" />
      </div>
      <div v-if="form.vision_enabled" class="f-row">
        <label>视觉模型</label>
        <input v-model="form.vision_model" class="m-input" placeholder="例如 gpt-4o" />
      </div>

      <div class="f-row">
        <label>附加参数</label>
        <textarea v-model="form.params_json" class="m-input" rows="2"
          placeholder='可选，JSON，例如 {"temperature":0.2}'></textarea>
      </div>

      <div v-if="testMsg" class="test-msg" :class="{ ok: testMsg.ok, error: !testMsg.ok }">
        {{ testMsg.message }}
      </div>

      <div class="actions">
        <button class="m-btn" :disabled="testing" @click="runTest">{{ testing ? '测试中…' : '测试连接' }}</button>
        <button class="m-btn" :disabled="editingId === null" @click="makeDefault">设为默认</button>
        <button class="m-btn danger" :disabled="editingId === null" @click="remove">删除</button>
        <button class="m-btn accent" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 250px 1fr;
  gap: 16px;
}
.new-btn {
  width: 100%;
  margin-bottom: 12px;
}
.model-item {
  border: 1px solid var(--line);
  background: var(--card);
  border-radius: 10px;
  padding: 11px 13px;
  margin-bottom: 9px;
  cursor: pointer;
}
.model-item.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.top b {
  font-size: 13px;
}
.badge {
  font-style: normal;
  font-size: 10px;
  background: var(--teal-soft);
  color: var(--teal);
  border: 1px solid var(--teal);
  border-radius: 5px;
  padding: 1px 7px;
}
.sub {
  font-size: 11px;
  color: var(--txt3);
}
.empty {
  font-size: 12px;
  color: var(--txt3);
  text-align: center;
  margin-top: 20px;
}
.f-row {
  display: grid;
  grid-template-columns: 110px 1fr;
  align-items: center;
  gap: 12px;
  margin-bottom: 13px;
}
.f-row label {
  font-size: 12.5px;
  color: var(--txt2);
}
.f-row.check {
  grid-template-columns: 110px auto;
}
.f-row.check input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent);
}
textarea {
  resize: vertical;
}
.test-msg {
  border-radius: 8px;
  padding: 8px 13px;
  font-size: 12px;
  margin: 4px 0 14px;
  background: var(--card2);
  border: 1px solid var(--line);
}
.test-msg.ok {
  color: var(--teal);
  border-color: var(--teal);
}
.test-msg.error {
  color: var(--danger);
  border-color: var(--danger);
}
.actions {
  display: flex;
  gap: 9px;
  justify-content: flex-end;
  margin-top: 6px;
}
.m-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.m-btn.danger {
  color: var(--danger);
}
</style>
