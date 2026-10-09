// 全局默认设置（settings 表的默认值种子）
export interface AppSettings {
  languageSource: string // 源语言：auto | zh-CN | en | ja | fr
  languageTarget: string // 目标语言
  /**
   * 画面（截图）翻译专用方向，与上面的聊天方向**互不联动**。
   *
   * 这两组方向天然相反：聊天框里玩家写中文要换成英文发给外国队友
   * （zh-CN → en），而截图要看画面上外国队友的英文并翻成中文
   * （en → zh-CN）。早先两组共用一个方向，结果截图翻译变成「英译英」，
   * 所以画面方向单独存一份、单独改。
   */
  screenSource: string // 画面翻译源语言：auto | zh-CN | en | ja | fr
  screenTarget: string // 画面翻译目标语言
  /**
   * 画面（截图）翻译风格：auto | daily | pro | toxic
   *
   * 与聊天方向的 translationStyle 分开存。理由和方向一样，两组场景要的语气天然相反：
   * 聊天翻译是「把我要发出去的话包装好」（可以说专业术语、甚至嘴臭），
   * 截图翻译是「读懂队友在说什么」（要直白、别自作主张加语气），
   * 共用一份风格时调了一边就会污染另一边。
   */
  screenStyle: string
  termLibrary: string // 术语库：general | dota2 | lol | pubg | cs2 | 自定义库 id
  translationStyle: string // 聊天方向风格：auto | daily | pro | toxic
  toxicLevel: string // 嘴臭火力档位：mild | trash | nuclear
  ocrEngine: string // local | vision | hybrid
  themeMode: string // dark | light | system
  accentColor: string // hex
  phraseTranslateBeforeSend: number // 0 | 1
  phraseAutoEnter: number // 0 | 1
  autoStart: number // 0 | 1
  minimizeToTray: number // 0 | 1
  termUpdateUrl: string // 术语库更新清单 URL
  /**
   * 用户在更新弹窗里选择「跳过此新版本并不再提醒」的那个版本号，空串表示没跳过任何版本。
   *
   * 只比较**完全相等**的版本号：将来发布更新的版本（比如跳过 1.0.1 后出了 1.0.2）
   * 必须重新弹出提示，否则用户会被永久锁死在旧版本上收不到更新。
   *
   * 本机键：换台机器换套偏好，不该跟着云快照漂过去，因此不入 CLOUD_SETTING_KEYS。
   * 必须是 string —— settings.ts 只对 DEFAULT_SETTINGS 里本来就是 number 的键做数值还原。
   */
  updateSkipVersion: string
  // 以下三个是**本机键**：既不进云快照白名单（见 CLOUD_SETTING_KEYS），也不参与鉴权。
  // 云端没有可写的账号名字段，昵称只在界面上展示；记住的邮箱只用于预填登录框。
  cloudNickname: string // 展示用昵称
  cloudAccountEmail: string // 「记住账号」时保留的邮箱
  cloudRememberAccount: number // 0 | 1：是否记住邮箱
  /**
   * 0 | 1：是否把登录密码保存在本机（默认 0）。
   *
   * 存的只是**开关**，不是密码。密码本体在 `cloudSavedPassword` 里，且那是
   * DPAPI 密文（base64）。渲染层只能写这个开关，绝不许直接写密文那个键。
   *
   * 本机键：绝不能进 CLOUD_SETTING_KEYS，密文一旦上云等于密码明文泄漏。
   */
  cloudSavePassword: number
  /**
   * 0 | 1：启动时用保存的邮箱 + 密码自动登录（默认 0）。
   *
   * 默认 0 是「每次打开都要重新登录」这条产品策略的载体：**不开启自动登录时，
   * 启动一律停���登录页**，本机会话即使没过期也会被清掉。
   * 开启它隐含必须先开 `cloudSavePassword` —— 没有密码就无法自动登录。
   */
  cloudAutoLogin: number
  /**
   * DPAPI 加密后的密码密文（base64）。**只能由主进程读写**，渲染层只碰开关。
   *
   * 明文永不落盘：写进来之前必过 `dpapiEncrypt`。换电脑 / 换 Windows 用户后
   * 这段密文解不开，此时主进程会清掉它并关掉自动登录，不会卡在反复重试里。
   */
  cloudSavedPassword: string
  /**
   * 0 | 1：是否把模型配置（含 API Key **明文**）随快照上传到云端。
   *
   * 默认 0，且**只能由用户显式打开**。开关为 1 时 API Key 会以明文离开本机 ——
   * 本机存的密文是 DPAPI 加密的，换台机器根本解不开，上云必须还原成明文，
   * 这正是界面上必须给出免责声明与二次确认的原因。
   *
   * 它是**本机键**：自己不上云（不在 CLOUD_SETTING_KEYS 里），只决定快照里
   * 那个独立的 `apiConfig` 字段要不要带。
   */
  cloudSyncApi: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  languageSource: 'auto',
  languageTarget: 'zh-CN',
  // 画面翻译的本质需求是「把画面上的外文翻成我能看懂的语言」，
  // 目标默认中文、源交给模型自己判断。这样默认两组方向一致，
  // 而用户把聊天方向改成 zh-CN → en 后画面方向不受影响。
  screenSource: 'auto',
  screenTarget: 'zh-CN',
  // 与聊天风格分开；默认 auto，老用户升级后画面翻译的语气与之前完全一致
  screenStyle: 'auto',
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
  termUpdateUrl: '',
  updateSkipVersion: '',
  cloudNickname: '',
  cloudAccountEmail: '',
  cloudRememberAccount: 1,
  cloudSavePassword: 0,
  cloudAutoLogin: 0,
  cloudSavedPassword: '',
  cloudSyncApi: 0
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
