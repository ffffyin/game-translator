import type { AppSettings } from '../../shared/defaults'

export interface GlossaryTerm {
  source_text: string
  target_text: string
}

const TARGET_NAMES: Record<string, string> = {
  'zh-CN': '中文（简体）',
  en: '英语',
  ja: '日语',
  fr: '法语'
}

const STYLE_INSTRUCTIONS: Record<string, string> = {
  auto: '自动判断原文语气，用自然贴切的对应语气翻译。',
  daily: '用轻松、日常的玩家口语翻译，语气像朋友之间聊天。',
  pro: '用职业电竞选手的简洁表达，正确使用竞技术语和报点说法。',
  toxic: '保留原文挑衅、嘲讽、嘴臭的语气进行翻译。'
}

export interface PromptInput {
  text: string
  settings: AppSettings
  terms?: GlossaryTerm[]
}

export function buildSystemPrompt(settings: AppSettings, terms?: GlossaryTerm[]): string {
  const targetName = TARGET_NAMES[settings.languageTarget] ?? settings.languageTarget
  const sourceNote =
    settings.languageSource === 'auto'
      ? '源语言自动检测。'
      : `源语言为${settings.languageSource}。`
  const style = STYLE_INSTRUCTIONS[settings.translationStyle] ?? STYLE_INSTRUCTIONS.auto

  let glossary = ''
  if (terms && terms.length > 0) {
    const lines = terms
      .slice(0, 60)
      .map((t) => `- ${t.source_text}：${t.target_text}`)
      .join('\n')
    glossary = `\n术语对照（必须按此翻译）：\n${lines}\n`
  }

  return [
    '你是一名游戏内聊天翻译助手。',
    `任务：把玩家发送的消息翻译成${targetName}。${sourceNote}`,
    style,
    '注意：',
    '- 只输出译文本身，不要加解释、前后缀、引号或标点以外的内容。',
    '- 原文可能是东南亚式英语（菲律宾、新加坡、马来西亚玩家使用，夹杂本地俚语和简写），按其真实含义翻译。',
    '- 游戏内专有词汇按游戏习惯说法翻译。',
    glossary
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildMessages(input: PromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: buildSystemPrompt(input.settings, input.terms) },
    { role: 'user', content: input.text }
  ]
}
