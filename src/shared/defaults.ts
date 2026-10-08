// 全局默认设置（settings 表的默认值种子）
export interface AppSettings {
  languageSource: string // 源语言：auto | zh-CN | en | ja | fr
  languageTarget: string // 目标语言
  termLibrary: string // 术语库：general | dota2 | lol | pubg | cs2 | 自定义库 id
  translationStyle: string // auto | daily | pro | toxic
  toxicLevel: string // 嘴臭火力档位：mild | trash | nuclear
  ocrEngine: string // local | vision | hybrid
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
  toxicLevel: 'trash',
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

// 嘴臭模式的火力档位（仅 translationStyle=toxic 时生效）
export const TOXIC_LEVELS = [
  { value: 'mild', label: '阴阳怪气', note: '夹枪带棒不爆粗' },
  { value: 'trash', label: '标准嘴臭', note: '直接开喷，推荐' },
  { value: 'nuclear', label: '火力全开', note: '骂到想退游' }
]

export function isToxicLevel(v: string): boolean {
  return TOXIC_LEVELS.some((l) => l.value === v)
}

// 截图识别通道：local 纯本地 / vision 纯 AI / hybrid 本地优先、失败自动降级 AI
export type OcrEngine = 'local' | 'vision' | 'hybrid'
// 实际执行识别的通道（hybrid 最终也会落到其中之一）
export type OcrRunEngine = 'local' | 'vision'

export const OCR_ENGINES: Array<{ value: OcrEngine; label: string; note: string }> = [
  { value: 'local', label: '本地 OCR', note: '免费 · 离线' },
  { value: 'vision', label: 'AI 视觉', note: '更准 · 耗额度' },
  { value: 'hybrid', label: '本地 + AI', note: '本地优先 · 识别不到再交给 AI' }
]

export function isOcrEngine(v: unknown): v is OcrEngine {
  return v === 'local' || v === 'vision' || v === 'hybrid'
}

// 非法值一律回落 local，避免脏数据让识别流程走进意外分支
export function normalizeOcrEngine(v: unknown): OcrEngine {
  return isOcrEngine(v) ? v : 'local'
}

// 模型是否真的可用视觉通道
export function canUseVision(config?: {
  vision_enabled?: number | null
  vision_model?: string | null
}): boolean {
  return !!config && config.vision_enabled === 1 && !!config.vision_model
}
