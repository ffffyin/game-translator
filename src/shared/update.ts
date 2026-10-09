// 软件更新：远端清单结构与纯逻辑（版本比较、体积格式化）。
//
// 这里刻意不放任何 Electron / fs / 网络代码，方便渲染层与主进程共用，也方便单测。
// 本轮只做「告知 + 引导下载」：不自动弹窗、不自动下载、不自动安装。
// 版本清单示例（version.json）：
// {
//   "version": "1.0.1",
//   "notes": ["修了什么", "加了什么"],
//   "publishedAt": "2026-10-09",
//   "downloadUrl": "https://.../game-translator-1.0.1-setup.exe",
//   "size": 138335923,
//   "sha256": "…",
//   "mandatory": false
// }

/** 远端版本清单的一条发布信息 */
export interface UpdateInfo {
  /** 新版本号，必须为 主版本.次版本.修订号（每段为数字） */
  version: string
  /** 更新说明，逐条展示 */
  notes: string[]
  /** 发布日期，纯展示用字符串（如 2026-10-09），可为空 */
  publishedAt: string
  /** 安装包下载地址，必须 http(s) */
  downloadUrl: string
  /** 安装包体积（字节）；未知为 0 */
  size: number
  /** 安装包 SHA256，供用户自行校验，可为空 */
  sha256: string
  /** 是否为强烈建议升级的版本（仅作提示，不强制） */
  mandatory: boolean
}

/** 检查结果三态，渲染层据此切换 UI */
export type UpdateCheckStatus = 'latest' | 'available' | 'error'

/** 检查更新的统一返回：无论成功失败都不抛异常 */
export interface UpdateCheckResult {
  /** 是否成功完成一次检查（网络/清单有问题时为 false） */
  ok: boolean
  status: UpdateCheckStatus
  /** 已是最新时为 true；出错时为 false */
  upToDate: boolean
  /** 清单信息。已是最新/有新版本时都有值（最新时可用于显示发布日期） */
  info?: UpdateInfo
  /** 给用户看的结论或失败原因 */
  message: string
}

/** 只认 主版本.次版本.修订号，段数不对、含非数字一律视为非法 */
const STRICT_VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

export interface Semver {
  major: number
  minor: number
  patch: number
}

/**
 * 解析版本号。合法返回三段数字，非法返回 null。
 * 容忍前缀 v（如 v1.0.1），但「1.0」「1.0.1.2」「1.0.x」都算非法。
 */
export function parseVersion(raw: string): Semver | null {
  if (typeof raw !== 'string') return null
  const matched = STRICT_VERSION_RE.exec(raw.trim())
  if (!matched) return null
  return {
    major: Number(matched[1]),
    minor: Number(matched[2]),
    patch: Number(matched[3])
  }
}

/**
 * 按语义化版本逐段比较：a > b 返回正数，a == b 返回 0，a < b 返回负数。
 * 任一传入非法则返回 null，交由调用方当「无法比较」处理。
 *
 * ⚠️ 必须逐段比数字，不能直接字符串比较：
 * 字符串比较下 '1.0.10' > '1.0.9' 会算出 false（'1' < '9'），
 * 于是十几次修订之后的新版本会被误判成旧版本，用户永远收不到更新提示。
 */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return null
  if (x.major !== y.major) return x.major - y.major
  if (x.minor !== y.minor) return x.minor - y.minor
  return x.patch - y.patch
}

/**
 * candidate 是否比 current 新。任一版本非法时返回 false：
 * 清单本身不可信时不该用它把用户推向下载。
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const cmp = compareVersions(candidate, current)
  return cmp !== null && cmp > 0
}

/**
 * 启动时的自动检查是否该弹「发现新版本」弹窗。
 *
 * 三条必须挡住的情况：
 * 1. 检查失败（网络断、清单坏、HTTP 500）—— 用户什么都没点，不该被打扰；
 * 2. 已是最新 —— 没有新内容可说；
 * 3. 这个版本用户上次选了「跳过此新版本并不再提醒」。
 *
 * ⚠️ 第 3 条**只能用在启动自动检查这条路径上**。用户在「关于软件」页主动点
 * 「检查软件更新」时是带着明确意图来的，那时必须原样显示结果——哪怕他之前
 * 跳过过这个版本，否则「手动检查」会变成一个永远查不到东西的死按钮。
 *
 * ⚠️ 跳过标记按**字符串全等**匹配：跳过的是 1.0.1 时将来发布 1.0.2 仍要弹。
 * 千万别写成「跳过 ≥ 某版本」这种语义，那等于替用户永久关掉更新提示。
 */
export function shouldPromptBootUpdate(result: UpdateCheckResult, skipVersion: string): boolean {
  if (!result.ok || result.status !== 'available') return false
  const info = result.info
  if (!info || !info.downloadUrl) return false
  const skipped = typeof skipVersion === 'string' ? skipVersion.trim() : ''
  return skipped !== info.version.trim()
}

/** 字节数转人类可读文案；非正数或非法数字返回空串（UI 据此不展示体积） */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  const mb = bytes / (1024 * 1024)
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}
