// 软件更新检查：拉取远端静态清单，比对版本号，把结论交给 UI。
//
// 设计约束（别改坏这几条）：
// 1. 只「告知 + 引导下载」，不自动弹窗、不自动下载、不自动安装；
// 2. 任何异常都必须被吞掉换成 UpdateCheckResult，绝不影响软件正常使用；
// 3. 清单地址是外部站点，**不要**用 fetchWithAuthOrigin（那玩意儿只给本应用云端域名
//    加 Origin/Referer，往外部更新源加料既没必要也不礼貌）。
import { APP_VERSION } from '../../shared/version'
import { UPDATE_MANIFEST_URL, isSafeExternalUrl } from '../../shared/links'
import {
  compareVersions,
  parseVersion,
  type UpdateCheckResult,
  type UpdateInfo
} from '../../shared/update'

/** 拉取清单的超时时间：断网或代理卡死时不能把「关于」页挂住 */
export const UPDATE_TIMEOUT_MS = 10_000

export interface CheckUpdateOptions {
  /** 清单地址，默认取 UPDATE_MANIFEST_URL */
  url?: string
  /** 超时毫秒数，默认 UPDATE_TIMEOUT_MS；超时即以「暂时无法检查」收场 */
  timeoutMs?: number
  /** 自定义 fetch，供单测注入 */
  fetchImpl?: typeof globalThis.fetch
  /** 当前版本号，默认取 APP_VERSION */
  currentVersion?: string
}

function failResult(message: string): UpdateCheckResult {
  return { ok: false, status: 'error', upToDate: false, message }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e))
}

function isAbortError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return e.name === 'AbortError' || e.name === 'TimeoutError' || /abort/i.test(e.message)
}

/** 网络类故障（连不上/解析不了主机/被墙/超时）统一给一句安稳话，别甩技术术语给用户 */
function looksLikeNetworkError(e: unknown): boolean {
  if (isAbortError(e)) return true
  const msg = e instanceof Error ? e.message : String(e)
  return /fetch failed|network|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|超时/i.test(msg)
}

/**
 * 校验清单必填字段并补齐可选字段的默认值。
 * 必填只有 version 与 downloadUrl：缺少其它字段只影响展示，不该判成清单坏了。
 */
function parseUpdateInfo(raw: unknown): UpdateInfo {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('版本清单不是有效的 JSON 对象')
  }
  const o = raw as Record<string, unknown>

  const version = typeof o.version === 'string' ? o.version.trim() : ''
  if (!version) throw new Error('版本清单缺少 version 字段')
  if (parseVersion(version) === null) {
    throw new Error(`版本号格式不合法：${version}（应为 主版本.次版本.修订号）`)
  }

  const downloadUrl = typeof o.downloadUrl === 'string' ? o.downloadUrl.trim() : ''
  if (!downloadUrl) throw new Error('版本清单缺少 downloadUrl 字段')
  if (!isSafeExternalUrl(downloadUrl)) {
    throw new Error('下载地址无效，需以 http(s):// 开头')
  }

  const notes = Array.isArray(o.notes)
    ? o.notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    : []
  const publishedAt = typeof o.publishedAt === 'string' ? o.publishedAt.trim() : ''
  const sha256 = typeof o.sha256 === 'string' ? o.sha256.trim() : ''
  const size = typeof o.size === 'number' && Number.isFinite(o.size) && o.size > 0 ? o.size : 0

  return { version, notes, publishedAt, downloadUrl, size, sha256, mandatory: o.mandatory === true }
}

/**
 * 拉取并解析清单。
 * 超时由我们自己计时兜底：不等底层 fetch 是否响应 signal，到点就 reject，
 * 避免某些实现忽略 signal 时整条链路挂死。
 */
async function fetchManifest(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof globalThis.fetch
): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('请求超时'))
    }, timeoutMs)
  })
  try {
    const pending = fetchImpl(url, {
      method: 'GET',
      // 只声明期望 JSON：外部站点不该带 Origin/Referer/凭证
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    const res = await Promise.race([pending, timeout])
    if (!res.ok) throw new Error(`更新服务器返回 HTTP ${res.status}`)
    return await res.json()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** 给静态清单加一次性时间戳，绕开 CDN / GitHub Pages 的缓存导致"明明有新版却说最新" */
function withCacheBuster(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_=${Date.now()}`
}

/**
 * 检查软件更新：从不抛异常，永远返回 UpdateCheckResult。
 * - 有新版本：status='available'，带完整 info（版本号/说明/体积/SHA256/下载地址）
 * - 已是最新：status='latest'，仍带 info 以便显示发布日期
 * - 检查失败：status='error'，message 是给用户看的原因
 */
export async function checkForUpdate(options: CheckUpdateOptions = {}): Promise<UpdateCheckResult> {
  const url = options.url ?? withCacheBuster(UPDATE_MANIFEST_URL)
  const timeoutMs = options.timeoutMs ?? UPDATE_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const current = options.currentVersion ?? APP_VERSION

  let raw: unknown
  try {
    raw = await fetchManifest(url, timeoutMs, fetchImpl)
  } catch (e) {
    if (looksLikeNetworkError(e)) {
      return failResult('暂时无法检查更新：网络不可用或请求超时，软件可正常使用')
    }
    return failResult(`检查更新失败：${toError(e).message}`)
  }

  let info: UpdateInfo
  try {
    info = parseUpdateInfo(raw)
  } catch (e) {
    return failResult(`版本清单格式有误：${toError(e).message}`)
  }

  const cmp = compareVersions(info.version, current)
  if (cmp === null) {
    return failResult(`版本号无法比较：清单 ${info.version} / 本机 ${current}`)
  }

  if (cmp <= 0) {
    return {
      ok: true,
      status: 'latest',
      upToDate: true,
      info,
      message: `当前已是最新版本 v${current}`
    }
  }

  return {
    ok: true,
    status: 'available',
    upToDate: false,
    info,
    message: `发现新版本 v${info.version}`
  }
}
