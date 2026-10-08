// 全局默认设置（settings 表的默认值种子）
export interface AppSettings {
  languageSource: string // 源语言：auto | zh-CN | en | ja | fr
  languageTarget: string // 目标语言
  termLibrary: string // 术语库：general | dota2 | lol | pubg | cs2 | 自定义库 id
  translationStyle: string // auto | daily | pro | toxic
  ocrEngine: string // local | vision
  themeMode: string // dark | light | system
  accentColor: string // hex
  phraseTranslateBeforeSend: number // 0 | 1
  phraseAutoEnter: number // 0 | 1
  autoStart: number // 0 | 1
  minimizeToTray: number // 0 | 1
  termUpdateUrl: string // 术语库更新清单 URL
}

export const DEFAULT_SETTINGS: AppSettings = {
  languageSource: 'auto',
  languageTarget: 'zh-CN',
  termLibrary: 'general',
  translationStyle: 'auto',
  ocrEngine: 'local',
  themeMode: 'dark',
  accentColor: '#F2B24C',
  phraseTranslateBeforeSend: 1,
  phraseAutoEnter: 0,
  autoStart: 0,
  minimizeToTray: 1,
  termUpdateUrl: ''
}

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>

export function isKnownSetting(key: string): key is keyof AppSettings {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)
}

// 语言选项（PRD 3）
export const LANGUAGES = [
  { value: 'auto', label: '自动检测（检测外语）' },
  { value: 'zh-CN', label: '中文（简体）' },
  { value: 'en', label: '英语' },
  { value: 'ja', label: '日语' },
  { value: 'fr', label: '法语' }
]

export const TERM_LIBRARIES = [
  { value: 'general', label: '通用' },
  { value: 'dota2', label: 'Dota2' },
  { value: 'lol', label: 'LOL' },
  { value: 'pubg', label: 'PUBG' },
  { value: 'cs2', label: 'CS2' }
]

export const TRANSLATION_STYLES = [
  { value: 'auto', label: '自动识别' },
  { value: 'daily', label: '日常交流' },
  { value: 'pro', label: '职业玩家' },
  { value: 'toxic', label: '嘴臭' }
]

export const OCR_ENGINES = [
  { value: 'local', label: '本地 OCR', note: '免费 · 离线' },
  { value: 'vision', label: 'AI 视觉', note: '更准 · 耗额度' }
]
