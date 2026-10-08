<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
import TermsManager from '../components/TermsManager.vue'
import PhrasesManager from '../components/PhrasesManager.vue'
import { useSettingsStore } from '../stores/settings'
import { TRANSLATION_STYLES, TOXIC_LEVELS } from '../../shared/defaults'

const s = useSettingsStore()

const styleNotes: Record<string, string> = {
  auto: '按原文自动判断语气',
  daily: '轻松自然的日常语气',
  pro: '竞技术语与报点表达',
  toxic: '三档火力，越往上越扎心'
}
</script>

<template>
  <PageHeader title="模式" note="翻译风格、术语库与常用语管理" />

  <div class="grid">
    <div class="m-card">
      <div class="lab">翻译风格</div>
      <button
        v-for="t in TRANSLATION_STYLES"
        :key="t.value"
        class="style-opt"
        :class="{ on: s.settings.translationStyle === t.value }"
        @click="s.update('translationStyle', t.value)"
      >
        <b>{{ t.label }}</b>
        <span>{{ styleNotes[t.value] }}</span>
      </button>

      <div v-if="s.settings.translationStyle === 'toxic'" class="toxic-levels">
        <div class="sub-lab">嘴臭火力</div>
        <button
          v-for="l in TOXIC_LEVELS"
          :key="l.value"
          class="lvl-opt"
          :class="{ on: s.settings.toxicLevel === l.value }"
          @click="s.update('toxicLevel', l.value)"
        >
          <b>{{ l.label }}</b>
          <span>{{ l.note }}</span>
        </button>
        <p class="tip">
          忠实原文：只会升级用词与语气，不会凭空编造原文没有的指控；仅针对游戏内表现开喷。
        </p>
      </div>
    </div>

    <div class="m-card">
      <div class="lab">常用语（Alt+1 ~ Alt+8 快速发送）</div>
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
      <PhrasesManager />
    </div>

    <div class="m-card">
      <div class="lab">通用</div>
      <div class="switches">
        <label class="switch-row">
          <input
            type="checkbox"
            :checked="s.settings.autoStart === 1"
            @change="s.update('autoStart', ($event.target as HTMLInputElement).checked ? 1 : 0)"
          />
          <span>开机自动启动</span>
        </label>
        <label class="switch-row">
          <input
            type="checkbox"
            :checked="s.settings.minimizeToTray === 1"
            @change="s.update('minimizeToTray', ($event.target as HTMLInputElement).checked ? 1 : 0)"
          />
          <span>关闭窗口时最小化到托盘</span>
        </label>
      </div>
    </div>

    <div class="m-card wide">
      <div class="lab">游戏术语库</div>
      <TermsManager />
    </div>
  </div>
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
.style-opt {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: var(--card2);
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 11px 13px;
  margin-bottom: 9px;
  cursor: pointer;
  color: var(--txt);
}
.style-opt b {
  font-size: 13px;
}
.style-opt span {
  font-size: 11.5px;
  color: var(--txt3);
}
.style-opt.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.toxic-levels {
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 11px;
}
.sub-lab {
  font-size: 12px;
  color: var(--txt2);
  margin-bottom: 8px;
}
.lvl-opt {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  background: var(--card);
  border: 1px dashed var(--line);
  border-radius: 9px;
  padding: 9px 12px;
  margin-bottom: 7px;
  cursor: pointer;
  color: var(--txt);
}
.lvl-opt b {
  font-size: 12.5px;
}
.lvl-opt span {
  font-size: 11px;
  color: var(--txt3);
}
.lvl-opt.on {
  border-style: solid;
  border-color: var(--accent);
  background: var(--accent-soft);
}
.tip {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--txt3);
}
.switches {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 4px 0 14px;
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
</style>
