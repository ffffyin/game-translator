<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import PageHeader from '../components/PageHeader.vue'
import PhrasesManager from '../components/PhrasesManager.vue'
import { useSettingsStore } from '../stores/settings'
import type { PhrasePageView } from '../../shared/phrases'

const s = useSettingsStore()

const pages = ref<PhrasePageView[]>([])
const selectedId = ref<number | null>(null)
const pageName = ref('')
const pageNote = ref('')
const msg = ref<{ ok: boolean; text: string } | null>(null)

const addingPage = ref(false)
const newPageName = ref('')
const newPageNote = ref('')
const confirmRemove = ref(false)

const selected = computed(() => pages.value.find((p) => p.id === selectedId.value) ?? null)
const activePage = computed(() => pages.value.find((p) => p.is_active === 1) ?? null)
const isActive = computed(() => selected.value?.is_active === 1)

function flash(ok: boolean, text: string): void {
  msg.value = { ok, text }
  setTimeout(() => (msg.value = null), 2600)
}

function syncForm(): void {
  pageName.value = selected.value?.name ?? ''
  pageNote.value = selected.value?.note ?? ''
}

async function loadPages(): Promise<void> {
  pages.value = await window.api.phrasesListPages()
  if (!pages.value.length) {
    selectedId.value = null
    return
  }
  if (selectedId.value == null || !pages.value.some((p) => p.id === selectedId.value)) {
    selectedId.value = (activePage.value ?? pages.value[0]).id
  }
  syncForm()
}

async function savePage(): Promise<void> {
  if (selectedId.value == null) return
  const name = pageName.value.trim()
  if (!name) {
    flash(false, '页名不能为空')
    return
  }
  await window.api.phrasesUpdatePage(selectedId.value, { name, note: pageNote.value.trim() })
  await loadPages()
  flash(true, '已保存')
}

async function makeActive(): Promise<void> {
  if (selectedId.value == null) return
  await window.api.phrasesSetActivePage(selectedId.value)
  await loadPages()
  flash(true, `已把「${selected.value?.name}」设为当前页，Alt+1~8 立即生效`)
}

async function submitNewPage(): Promise<void> {
  const name = newPageName.value.trim()
  if (!name) return
  const id = await window.api.phrasesCreatePage({ name, note: newPageNote.value.trim() || undefined })
  addingPage.value = false
  newPageName.value = ''
  newPageNote.value = ''
  selectedId.value = id
  await loadPages()
  selectedId.value = id
  syncForm()
  flash(true, '话术页已创建，可点「设为当前页」让它接管 Alt+1~8')
}

async function removePage(): Promise<void> {
  if (selectedId.value == null) return
  const r = await window.api.phrasesRemovePage(selectedId.value)
  confirmRemove.value = false
  if (!r.ok) {
    flash(false, r.error ?? '删除失败')
    return
  }
  selectedId.value = null
  await loadPages()
  flash(true, '话术页已删除')
}

onMounted(() => loadPages().catch((e) => flash(false, String(e))))
watch(selectedId, () => {
  confirmRemove.value = false
  syncForm()
})
</script>

<template>
  <PageHeader title="常用语" note="按游戏分页管理话术，Alt+1 ~ Alt+8 发送当前页的槽位" />

  <div class="m-card">
    <div class="lab">发送行为</div>
    <div class="switches">
      <label class="switch-row">
        <input
          type="checkbox"
          :checked="s.settings.phraseTranslateBeforeSend === 1"
          @change="s.update('phraseTranslateBeforeSend', ($event.target as HTMLInputElement).checked ? 1 : 0)"
        />
        <span>发送前先翻译（默认开）</span>
      </label>
      <label class="switch-row">
        <input
          type="checkbox"
          :checked="s.settings.phraseAutoEnter === 1"
          @change="s.update('phraseAutoEnter', ($event.target as HTMLInputElement).checked ? 1 : 0)"
        />
        <span>粘贴后自动回车发送（默认关）</span>
      </label>
    </div>
    <p class="tip">
      当前页：<b>{{ activePage?.name ?? '—' }}</b> ·
      Alt+1 ~ Alt+8 只发送这一页的 8 条话术。切换到别的话术页后按键内容立即改绑，不需要重启。
    </p>
  </div>

  <div class="layout">
    <div class="left m-card">
      <div class="lab">话术页</div>

      <button
        v-for="p in pages"
        :key="p.id"
        class="page-item"
        :class="{ on: selectedId === p.id }"
        @click="selectedId = p.id"
      >
        <div class="top">
          <b>{{ p.name }}</b>
          <i v-if="p.is_active === 1" class="badge">当前</i>
        </div>
        <span class="sub">{{ p.note || '未填备注' }} · {{ p.count }} 条</span>
      </button>

      <div v-if="!pages.length" class="empty">还没有话术页</div>

      <button v-if="!addingPage" class="m-btn accent new-btn" @click="addingPage = true">
        ＋ 新建话术页
      </button>
      <div v-else class="new-page">
        <input v-model="newPageName" class="m-input" placeholder="页名，例如：Valorant" maxlength="20" />
        <input v-model="newPageNote" class="m-input" placeholder="备注，例如：技能报点" maxlength="30" />
        <div class="new-ops">
          <button class="m-btn accent" @click="submitNewPage">创建</button>
          <button class="m-btn" @click="addingPage = false">取消</button>
        </div>
      </div>
    </div>

    <div class="right m-card">
      <template v-if="selected">
        <div class="head">
          <div class="fields">
            <input v-model="pageName" class="m-input name" placeholder="页名" maxlength="20" />
            <input v-model="pageNote" class="m-input" placeholder="备注（可选）" maxlength="30" />
          </div>
          <div class="ops">
            <button
              class="m-btn accent"
              :disabled="isActive"
              :title="isActive ? '已经是当前页' : '让 Alt+1~8 发送这一页'"
              @click="makeActive"
            >
              {{ isActive ? '当前页' : '设为当前页' }}
            </button>
            <button class="m-btn" @click="savePage">保存</button>
            <template v-if="confirmRemove">
              <button class="m-btn danger" @click="removePage">确认删除</button>
              <button class="m-btn" @click="confirmRemove = false">取消</button>
            </template>
            <button v-else class="m-btn danger" @click="confirmRemove = true">删除</button>
          </div>
        </div>

        <div v-if="msg" class="msg" :class="{ ok: msg.ok, error: !msg.ok }">{{ msg.text }}</div>

        <div class="sub-lab">本页话术（前 8 条对应 Alt+1 ~ Alt+8）</div>
        <PhrasesManager :page-id="selectedId" />
      </template>
      <div v-else class="empty">左侧新建一个话术页后即可添加话术</div>
    </div>
  </div>
</template>

<style scoped>
.switches {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 10px;
}
.switch-row {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 12.5px;
  color: var(--txt2);
  cursor: pointer;
}
.switch-row input {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
  cursor: pointer;
}
.tip {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--txt3);
  margin: 0;
}
.tip b {
  color: var(--accent);
}
.layout {
  display: grid;
  grid-template-columns: 248px 1fr;
  gap: 16px;
  margin-top: 16px;
}
.page-item {
  width: 100%;
  text-align: left;
  border: 1px solid var(--line);
  background: var(--card2);
  border-radius: 10px;
  padding: 10px 13px;
  margin-bottom: 9px;
  cursor: pointer;
  color: var(--txt);
}
.page-item.on {
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
.new-btn {
  width: 100%;
  margin-top: 4px;
}
.new-page {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 4px;
}
.new-ops {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 10px;
}
.fields {
  display: flex;
  gap: 8px;
  flex: 1;
}
.fields .name {
  max-width: 170px;
}
.ops {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.ops .m-btn {
  padding: 6px 11px;
  font-size: 12px;
}
.ops .m-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sub-lab {
  font-size: 12px;
  color: var(--txt2);
  margin-bottom: 8px;
}
.msg {
  font-size: 11.5px;
  border-radius: 8px;
  padding: 7px 11px;
  margin-bottom: 10px;
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
.empty {
  font-size: 12.5px;
  color: var(--txt3);
  text-align: center;
  padding: 22px 0;
}
</style>
