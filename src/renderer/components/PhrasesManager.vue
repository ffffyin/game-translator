<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type { PhraseView } from '../../shared/phrases'

const props = defineProps<{ pageId: number | null }>()

const rows = ref<PhraseView[]>([])
const loadError = ref('')

const adding = ref(false)
const newContent = ref('')

const editingId = ref<number | null>(null)
const editContent = ref('')

const confirmId = ref<number | null>(null)

async function load(): Promise<void> {
  if (props.pageId == null) {
    rows.value = []
    return
  }
  rows.value = await window.api.phrasesList(props.pageId)
}

async function submitAdd(): Promise<void> {
  const content = newContent.value.trim()
  if (!content || props.pageId == null) return
  await window.api.phrasesCreate(props.pageId, content)
  adding.value = false
  newContent.value = ''
  await load()
}

function startEdit(p: PhraseView): void {
  editingId.value = p.id
  editContent.value = p.content
}

async function submitEdit(): Promise<void> {
  if (editingId.value == null) return
  if (!editContent.value.trim()) return
  await window.api.phrasesUpdate(editingId.value, editContent.value.trim())
  editingId.value = null
  await load()
}

async function toggle(p: PhraseView): Promise<void> {
  await window.api.phrasesSetEnabled(p.id, p.enabled !== 1)
  await load()
}

async function move(p: PhraseView, dir: 'up' | 'down'): Promise<void> {
  await window.api.phrasesMove(p.id, dir)
  await load()
}

async function confirmRemove(): Promise<void> {
  if (confirmId.value == null) return
  await window.api.phrasesRemove(confirmId.value)
  confirmId.value = null
  await load()
}

onMounted(() => load().catch((e) => (loadError.value = String(e))))

// 切换话术页时重新加载该页条目
watch(
  () => props.pageId,
  () => {
    adding.value = false
    editingId.value = null
    confirmId.value = null
    load().catch((e) => (loadError.value = String(e)))
  }
)
</script>

<template>
  <div class="phrases">
    <div class="tools">
      <button v-if="!adding" class="m-btn accent" @click="adding = true">＋ 添加常用语</button>
      <div v-else class="add-row">
        <input v-model="newContent" class="m-input" placeholder="输入常用语文案" maxlength="120" />
        <button class="m-btn accent" @click="submitAdd">保存</button>
        <button class="m-btn" @click="adding = false">取消</button>
      </div>
    </div>

    <table class="p-table">
      <colgroup>
        <col style="width: 56%" />
        <col style="width: 14%" />
        <col style="width: 10%" />
        <col style="width: 20%" />
      </colgroup>
      <thead>
        <tr>
          <th>文字</th>
          <th>快捷键</th>
          <th>启用</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(p, i) in rows" :key="p.id" :class="{ off: p.enabled !== 1 }">
          <td>
            <template v-if="editingId === p.id">
              <input v-model="editContent" class="m-input" maxlength="120" />
            </template>
            <template v-else>{{ p.content }}</template>
          </td>
          <td>
            <kbd v-if="p.accelerator">{{ p.accelerator }}</kbd>
            <span v-else class="dim">—</span>
          </td>
          <td>
            <button class="switch" :class="{ on: p.enabled === 1 }" @click="toggle(p)">
              <span class="dot"></span>
            </button>
          </td>
          <td class="ops">
            <template v-if="confirmId === p.id">
              <span class="warn">确认？</span>
              <button class="link danger" @click="confirmRemove">删除</button>
              <button class="link" @click="confirmId = null">取消</button>
            </template>
            <template v-else-if="editingId === p.id">
              <button class="link" @click="submitEdit">保存</button>
              <button class="link" @click="editingId = null">取消</button>
            </template>
            <template v-else>
              <button class="link" :disabled="i === 0" title="上移" @click="move(p, 'up')">↑</button>
              <button class="link" :disabled="i === rows.length - 1" title="下移" @click="move(p, 'down')">↓</button>
              <button class="link" @click="startEdit(p)">编辑</button>
              <button class="link danger" @click="confirmId = p.id">删除</button>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!rows.length" class="empty">还没有常用语，点击「添加常用语」创建</div>
    <div v-if="loadError" class="form-err">{{ loadError }}</div>
  </div>
</template>

<style scoped>
.tools {
  margin-bottom: 12px;
}
.add-row {
  display: flex;
  gap: 8px;
}
.add-row .m-input {
  flex: 1;
}
.p-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 12.5px;
}
.p-table th {
  text-align: left;
  font-weight: 600;
  color: var(--txt3);
  font-size: 11.5px;
  padding: 7px 8px;
  border-bottom: 1px solid var(--line);
}
.p-table td {
  padding: 8px;
  border-bottom: 1px solid var(--line);
  color: var(--txt);
  word-break: break-word;
  vertical-align: middle;
}
tr.off td {
  opacity: 0.55;
}
kbd {
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 2px 9px;
  font-size: 11.5px;
  color: var(--txt);
  font-family: inherit;
}
.dim {
  color: var(--txt3);
}
.switch {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--card2);
  border: 1px solid var(--line);
  position: relative;
  cursor: pointer;
  padding: 0;
}
.switch .dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--txt3);
  transition: transform 0.15s;
}
.switch.on {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.switch.on .dot {
  background: var(--accent);
  transform: translateX(16px);
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
.link:disabled {
  color: var(--txt3);
  cursor: default;
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
.form-err {
  color: var(--danger);
  font-size: 11.5px;
  margin-top: 8px;
}
</style>
