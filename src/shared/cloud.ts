// 云端账号同步的数据契约（纯类型 + 纯校验，可在单测里直接跑）
//
// 三条边界，改动前先看这里：
//  1. 上云的只有用户自己的内容：设置项、自定义术语库、常用语。
//  2. 绝不上云：模型地址、API Key（本机 DPAPI 加密，换机器本就解不开）、用量统计、备份文件。
//  3. 本机永远可用 —— 未登录 / 断网 / 云端报错都不该影响本地功能，登录是「加成」不是「门槛」。

/** 云端配置行的作用域：一个账号一行。预留 scope 方便以后做多档位（如「工作/家用」）。 */
export const CLOUD_SCOPE = 'default'

/** 快照格式版本。格式不兼容变更时必须 +1，旧数据一律拒绝而不是猜。 */
export const CLOUD_SNAPSHOT_VERSION = 1

// 允许上云的设置项：不含任何凭据，并排除与本机强绑定的开关（开机自启、最小化到托盘）
export const CLOUD_SETTING_KEYS = [
  'languageSource',
  'languageTarget',
  'termLibrary',
  'translationStyle',
  'toxicLevel',
  'ocrEngine',
  'themeMode',
  'accentColor',
  'phraseTranslateBeforeSend',
  'phraseAutoEnter',
  'termUpdateUrl'
] as const

export type CloudSettingKey = (typeof CLOUD_SETTING_KEYS)[number]

export function isCloudSettingKey(key: string): key is CloudSettingKey {
  return (CLOUD_SETTING_KEYS as readonly string[]).includes(key)
}

export interface CloudTerm {
  /** source_text */
  s: string
  /** target_text */
  t: string
  tag?: string
}

export interface CloudTermLib {
  name: string
  game: string
  terms: CloudTerm[]
}

export interface CloudPhraseItem {
  slot: number
  content: string
  enabled: number
}

export interface CloudPhrasePage {
  name: string
  note: string
  items: CloudPhraseItem[]
}

export interface CloudSnapshot {
  version: number
  settings: Record<string, string>
  /** 只含用户自建（is_builtin=0）的术语库：内置库随软件分发、可联网更新，不必占云端空间 */
  termLibs: CloudTermLib[]
  phrasePages: CloudPhrasePage[]
  activePhrasePage: string | null
}

export function emptySnapshot(): CloudSnapshot {
  return {
    version: CLOUD_SNAPSHOT_VERSION,
    settings: {},
    termLibs: [],
    phrasePages: [],
    activePhrasePage: null
  }
}

export interface CloudSummary {
  termLibs: number
  terms: number
  phrasePages: number
  phrases: number
}

export function snapshotSummary(s: CloudSnapshot): CloudSummary {
  return {
    termLibs: s.termLibs.length,
    terms: s.termLibs.reduce((n, l) => n + l.terms.length, 0),
    phrasePages: s.phrasePages.length,
    phrases: s.phrasePages.reduce((n, p) => n + p.items.length, 0)
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// 云端数据一律当不可信输入处理：字段缺失/类型不对就整体拒绝，
// 半信半疑地导入一半会让术语库变成「看着像同步了、其实缺了一堆」的脏状态。
export function validateSnapshot(
  raw: unknown
): { ok: true; data: CloudSnapshot } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: '云端数据不是对象' }
  if (raw.version !== CLOUD_SNAPSHOT_VERSION) {
    return { ok: false, error: `云端数据版本为 ${String(raw.version)}，本软件只支持 ${CLOUD_SNAPSHOT_VERSION}，请升级软件后再同步` }
  }
  if (!isRecord(raw.settings)) return { ok: false, error: 'settings 字段缺失' }
  if (!Array.isArray(raw.termLibs)) return { ok: false, error: 'termLibs 字段缺失' }
  if (!Array.isArray(raw.phrasePages)) return { ok: false, error: 'phrasePages 字段缺失' }

  const settings: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw.settings)) {
    // 未知设置项静默丢弃：老版本客户端上传过的字段不该让新版本导入失败
    if (!isCloudSettingKey(k)) continue
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') continue
    settings[k] = String(v)
  }

  const termLibs: CloudTermLib[] = []
  for (const lib of raw.termLibs) {
    if (!isRecord(lib)) return { ok: false, error: '术语库条目不是对象' }
    if (typeof lib.name !== 'string' || !lib.name.trim()) return { ok: false, error: '术语库缺少名称' }
    if (!Array.isArray(lib.terms)) return { ok: false, error: `术语库「${lib.name}」的 terms 字段缺失` }
    const terms: CloudTerm[] = []
    for (const t of lib.terms) {
      if (!isRecord(t)) continue
      if (typeof t.s !== 'string' || typeof t.t !== 'string') continue
      if (!t.s.trim() || !t.t.trim()) continue
      terms.push({ s: t.s, t: t.t, tag: typeof t.tag === 'string' ? t.tag : undefined })
    }
    termLibs.push({ name: lib.name, game: typeof lib.game === 'string' ? lib.game : '', terms })
  }

  const phrasePages: CloudPhrasePage[] = []
  for (const p of raw.phrasePages) {
    if (!isRecord(p)) return { ok: false, error: '常用语分页条目不是对象' }
    if (typeof p.name !== 'string' || !p.name.trim()) return { ok: false, error: '常用语分页缺少名称' }
    if (!Array.isArray(p.items)) continue
    const items: CloudPhraseItem[] = []
    for (const it of p.items) {
      if (!isRecord(it)) continue
      if (typeof it.content !== 'string') continue
      const slot = Number(it.slot)
      items.push({
        slot: Number.isFinite(slot) ? slot : items.length + 1,
        content: it.content,
        enabled: Number(it.enabled) === 1 ? 1 : 0
      })
    }
    phrasePages.push({ name: p.name, note: typeof p.note === 'string' ? p.note : '', items })
  }

  return {
    ok: true,
    data: {
      version: CLOUD_SNAPSHOT_VERSION,
      settings,
      termLibs,
      phrasePages,
      activePhrasePage: typeof raw.activePhrasePage === 'string' ? raw.activePhrasePage : null
    }
  }
}

/** 单个云端配置行（user_settings 表的形状） */
export interface CloudSettingsRow {
  id?: number
  scope: string
  payload: unknown
  updated_at?: string
}

/** 登录态 + 云端概况，渲染层据此渲染账号页 */
export interface CloudStatus {
  /** 云端能力是否可用（配置齐全、初始化成功） */
  available: boolean
  signedIn: boolean
  userId: string | null
  email: string | null
  phone: string | null
  /** 云端最近一次保存时间（ISO 字符串），没有云端数据为 null */
  remoteUpdatedAt: string | null
  /** 云端快照摘要，没有云端数据为 null */
  remoteSummary: CloudSummary | null
  /** 上次状态刷新是否成功：断网时为 false，界面仍显示缓存的账号信息 */
  online: boolean
  message: string
}

export function offlineStatus(message: string): CloudStatus {
  return {
    available: true,
    signedIn: false,
    userId: null,
    email: null,
    phone: null,
    remoteUpdatedAt: null,
    remoteSummary: null,
    online: false,
    message
  }
}

export interface CloudOtpChallenge {
  verificationId: string
  /** 该邮箱是否已注册：决定验码后走登录还是注册，由服务端判断 */
  isExistingUser: boolean
}

/** 发验证码的结果：ok 时 verificationId 要带到下一步 */
export interface CloudOtpResult extends CloudOtpChallenge {
  ok: boolean
  message: string
}

/** 验码登录的结果：无论成败都带上最新登录态，界面不需要再单独查一次 */
export interface CloudVerifyResult {
  ok: boolean
  message: string
  status: CloudStatus
}

export interface CloudSyncResult {
  ok: boolean
  message: string
  summary?: CloudSummary
  updatedAt?: string
}

export interface CloudSimpleResult {
  ok: boolean
  message: string
}
