import { join } from 'path'
import { app } from 'electron'
import {
  createWorkBuddyCloud,
  CLOUD_MODULE_PATHS,
  PUBLISHABLE_KEY_HEADER
} from '@tencent-ai/workbuddy-cloud-sdk'
import type { CloudSession, WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk'
import type { Db } from './db-wrapper'
import { SecureAuthStorage } from './cloud-storage'
import { buildSnapshot, applySnapshot } from './cloud-snapshot'
import { createBackup } from './backup'
import { invalidateTermCache } from './term-cache'
import { log } from './logger'
import { readSetting, writeSetting } from './settings'
import { APP_VERSION } from '../../shared/version'
import {
  validateEmail,
  validatePassword,
  validateNickname,
  normalizeNickname,
  validateCode,
  maskEmail,
  PASSWORD_MAX,
  type AccountSignInInput,
  type AccountSignUpInput,
  type AccountResetInput,
  type AccountChangePasswordInput
} from '../../shared/account'
import {
  CLOUD_SCOPE,
  CLOUD_SNAPSHOT_VERSION,
  snapshotSummary,
  validateSnapshot,
  type CloudStatus,
  type CloudSyncResult,
  type CloudSimpleResult,
  type CloudSummary,
  type CloudOtpResult,
  type CloudAuthResult
} from '../../shared/cloud'

// 云服务配置：publishableKey 只标识「哪个应用」，本身不携带权限，
// 可以随客户端分发；真正的拦截在服务端（RLS：owner_id = auth.uid()）。
const CLOUD_ENDPOINT = 'https://game-translator.app.workbuddy.host'
const CLOUD_PUBLISHABLE_KEY = 'wbpk_j7gSzC4Hd9cFphl7a2wJmo_wLuzfc9Zh2tvfBUXpw1FiIEZJQe6OUfO'
const CLOUD_OAUTH_RELAY = 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'

// ---------------------------------------------------------------------------
// 直连 HTTP 只用在这一条链路上：忘记密码。
//
// SDK 的 auth 暴露的 resetPasswordForEmail(email) 返回的是
// `PasswordResetChallenge { updateUser({nonce, password}) }` —— **不给** verificationId，
// 而是把它关在闭包里。这在两处与我们的界面流程冲突：
//  1. 发码与重置之间隔着一次 IPC 往返，闭包（函数）没法跨进程传给渲染层；
//  2. updateUser 内部会在重置成功后立刻自动登录，并把「自动登录失败」当作整体失败
//     返回 —— 于是「其实已经重置成功」被包装成一次失败，用户会以为没改成功。
// 所以这里照 SDK 自己用的同一组路径与请求头直连，自己串起
// 「验码 → 重置 → 用新密码登录」三步。请求头一律走 authHeaders() 补上应用来源，
// 否则服务端会以 401 invalid_grant 拒签令牌（详见下方 AUTH_ORIGIN 处的实测记录）。
//
// 基址与请求头直接复用 SDK 导出的常量，避免我们写死一份、SDK 升级后悄悄错位；
// 只有三个 /v1/** 子路径没被导出，照 SDK 内部 AUTH_PATHS 原样抄下来。
// ---------------------------------------------------------------------------
const AUTH_HTTP_BASE = `${CLOUD_ENDPOINT}${CLOUD_MODULE_PATHS.auth}`
const AUTH_KEY_HEADER = PUBLISHABLE_KEY_HEADER
const AUTH_PATH_VERIFICATION = '/v1/verification'
const AUTH_PATH_VERIFICATION_VERIFY = '/v1/verification/verify'
const AUTH_PATH_RESET = '/v1/reset'

// 所有发往本应用云端 endpoint 的请求都必须带「应用来源」，否则服务端一律拒签/拒认。
// auth 与 database 两条路径都实测过，缺 Origin 的表现同为
// `invalid_grant: the session is invalid, expired or issued for another client`。
// 实测对照：
//
//   POST /v1/signin 不带 Origin
//     -> 401 invalid_grant "the session is invalid, expired or issued for another client"
//   POST /v1/signin 带 Origin: https://game-translator.app.workbuddy.host
//     -> 200 + access_token
//
// 这个 401 极具误导性：用户名其实存在、密码也是对的，被拒的是「签发令牌」这一步。
// 早先拿不存在的邮箱去试探会拿到 400 "Username or password incorrect."（在校验凭据时
// 就返回了，根本走不到签发令牌），所以看不出 Origin 才是变量 —— 这个坑记在这里，别再踩。
// 签出的 JWT 里 `azp` 字段正是这个 endpoint，说明服务端把会话绑定到了应用来源。
//
// Electron 主进程的 fetch 不是浏览器，天然不带 Origin，必须手动补；
// 渲染进程反过来做不到：浏览器强制带的 Origin 是 file:// 或 localhost，不是我们的域名，
// 同样会被拒。这也是云调用必须留在主进程、且还需要这层包装的原因。
const AUTH_ORIGIN = CLOUD_ENDPOINT

/** 在原有请求头之上补 origin / referer，不覆盖调用方已经设置的值。 */
function authHeaders(extra?: HeadersInit): Headers {
  const h = new Headers(extra)
  if (!h.has('origin')) h.set('origin', AUTH_ORIGIN)
  if (!h.has('referer')) h.set('referer', AUTH_ORIGIN + '/')
  return h
}

/**
 * 注入 SDK 的 fetch：给发往本应用云端的请求补来源头，其余请求原样透传。
 * 只认 CLOUD_ENDPOINT 前缀，不会顺手给别的请求（比如模型厂商接口）加料。
 */
export function fetchWithAuthOrigin(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const url = String(raw ?? '')
  if (!url.startsWith(CLOUD_ENDPOINT)) return fetch(input as RequestInfo, init)
  return fetch(input as RequestInfo, { ...init, headers: authHeaders(init?.headers) })
}

const CREDENTIAL_FILE = 'cloud-session.enc'

// SDK 的 database 泛型默认 unknown，from() 的约束会退化成 never；
// 这里把它收成我们真正用到的那几个动作，避免整条调用链都变成 any。
type CloudResultLike = { data: unknown; error: unknown }
interface CloudQuery extends PromiseLike<CloudResultLike> {
  select(columns: string): CloudQuery
  eq(column: string, value: unknown): CloudQuery
  upsert(rows: Record<string, unknown>, options?: { onConflict?: string }): CloudQuery
  delete(): CloudQuery
  maybeSingle(): CloudQuery
}
interface CloudDatabase {
  from(table: string): CloudQuery
}

interface CloudErrorLike {
  kind?: string
  message?: string
  status?: number
  code?: string
}

function errorText(e: unknown, fallback: string): string {
  if (!e) return fallback
  const err = e as CloudErrorLike
  if (typeof err.message === 'string' && err.message.trim()) return err.message
  return fallback
}

function isNetworkish(e: unknown): boolean {
  const err = e as CloudErrorLike
  return err?.kind === 'network' || err?.status === 0
}

// 登录失效（token 过期/被服务端踢掉）统一成一句人话。
// 服务端此时回的是 PostgREST 的 42501 / HTTP 401，直接把原文抛给用户只会看到
// "permission denied for table user_settings"，没人看得懂该去重新登录。
function isAuthFailure(e: unknown): boolean {
  const err = e as CloudErrorLike
  if (err?.kind === 'unauthenticated' || err?.kind === 'permission-denied') return true
  if (err?.status === 401 || err?.status === 403) return true
  return typeof err?.code === 'string' && /42501|PGRST301|JWT/i.test(err.code)
}

const AUTH_EXPIRED = '登录状态已失效，请重新登录'
const NETWORK_DOWN = '网络不可用，暂时无法连接云端（本地功能不受影响）'
/** 冷启动即断网、凭据还没过期时的兜底提示 */
const OFFLINE_CACHED = '离线状态，已使用本机保存的登录凭据'
const GENERIC_FAILURE = '操作失败，请稍后重试'
const RATE_LIMITED = '发送太频繁，请 1 分钟后再试'
const OTP_BACKEND_DOWN = '验证码服务暂时不可用，请稍后再试'
const BAD_CREDENTIALS = '邮箱或密码不正确'
const TOO_FAST = '操作太快了，请稍后重试'
const NO_SUCH_ACCOUNT = '该邮箱还没有注册账号'

/** 只认 CJK 表意文字与扩展区：判断「这句是不是中国用户看得懂的话」 */
const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/

/**
 * 英文原文判据：一个汉字都没有、但确实有拉丁字母。
 *
 * 服务端（含 Postgres / PostgREST 与上游 provider）报错一律是英文，
 * 例如 "permission denied for table user_settings"、"Username or password
 * incorrect"、"new_password does not match ^$|^.{4,60}$"。这些直接上屏等于
 * 把内部实现细节丢给用户，所以一律替换成通用文案，原文只进日志。
 */
function isEnglishOnly(s: string): boolean {
  if (!s || !s.trim()) return false
  if (CJK_RE.test(s)) return false
  return /[A-Za-z]/.test(s)
}

function describe(e: unknown, fallback: string): string {
  if (isNetworkish(e)) return NETWORK_DOWN
  if (isAuthFailure(e)) return AUTH_EXPIRED

  const err = e as CloudErrorLike
  const status = typeof err?.status === 'number' ? err.status : -1
  const kind = typeof err?.kind === 'string' ? err.kind : ''
  const code = typeof err?.code === 'string' ? err.code : ''
  const msg = typeof err?.message === 'string' ? err.message : ''
  const text = `${code} ${msg}`

  // 发码限流：服务端是 1 条/分钟/邮箱，第二次必挂，必须告诉用户等多久
  if (kind === 'rate-limited' || status === 429 || /per minute/i.test(text)) return RATE_LIMITED
  // 502 是发码链路不可用的典型表现（不可投递域名如 @example.com 也会吃到）
  if (status === 502 || kind === 'backend-unavailable') return OTP_BACKEND_DOWN
  if (code === 'INVALID_USERNAME_OR_PASSWORD' || /Username or password incorrect/i.test(text)) {
    return BAD_CREDENTIALS
  }
  if (/key lookup throttled/i.test(text)) return TOO_FAST
  if (/user not found|no such user|not registered|用户不存在|账号不存在/i.test(text)) {
    return NO_SUCH_ACCOUNT
  }
  // 注册撞上已注册邮箱：不映射的话用户只会看到一句「操作失败」，不知道该去登录
  if (/already (exists|registered)|user already|已注册/i.test(text)) {
    return '该邮箱已注册，请直接登录'
  }

  if (!msg.trim()) return fallback
  if (isEnglishOnly(msg)) {
    log('WARN', `云端错误未命中映射，已替换为通用文案：${msg}`)
    return GENERIC_FAILURE
  }
  return msg
}

// 直连 HTTP 的错误归一：与 SDK 的 errorKind / normalizeHttpError 保持同一套形状，
// 这样 describe() 不用区分「SDK 抛的」还是「我们直连撞上的」。
function kindFromStatus(status: number): string {
  switch (status) {
    case 400:
      return 'invalid-request'
    case 401:
      return 'unauthenticated'
    case 403:
      return 'permission-denied'
    case 404:
      return 'not-found'
    case 429:
      return 'rate-limited'
    case 501:
      return 'unimplemented'
    case 502:
    case 503:
      return 'backend-unavailable'
    default:
      return status >= 500 ? 'backend-unavailable' : 'unknown'
  }
}

function pickHttpMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const p = payload as Record<string, unknown>
    for (const k of ['error_description', 'message', 'msg'] as const) {
      const v = p[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    if (typeof p.error === 'string' && p.error.trim()) return p.error
  }
  return `HTTP ${status}`
}

interface RawAuthError {
  kind: string
  message: string
  status: number
  code?: string
}

type AuthHttpResult = {
  data: Record<string, unknown> | null
  error: RawAuthError | null
}

export class CloudService {
  private client: WorkBuddyCloudClient | null = null
  private storage: SecureAuthStorage | null = null
  private initError: string | null = null
  // 断网时仍要能显示「上次是谁登录的」：状态在内存里留一份快照
  private cached: CloudStatus | null = null

  constructor(
    private readonly root: string,
    private readonly getDb: () => Db
  ) {}

  async init(): Promise<void> {
    if (this.client) return
    const storage = new SecureAuthStorage(join(this.root, CREDENTIAL_FILE))
    try {
      await storage.load()
      this.client = createWorkBuddyCloud({
        endpoint: CLOUD_ENDPOINT,
        publishableKey: CLOUD_PUBLISHABLE_KEY,
        oauthRelayBaseUrl: CLOUD_OAUTH_RELAY,
        storage,
        // 没有这一层，主进程发出的 signin / verifyOtp 会被服务端拒签令牌（401 invalid_grant）
        fetch: fetchWithAuthOrigin
      })
      this.storage = storage
      // 会话一变就落盘：刷新 token 是 SDK 内部发起的，不挂这个钩子的话
      // 只有「退出前 600ms 内刚好没刷新」才留得住新 token，重开就要重新登录。
      this.client.auth.onAuthStateChange((event) => {
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
          void storage.flush()
        }
      })
      app.on('before-quit', () => {
        void storage.flush()
      })
    } catch (e) {
      this.initError = errorText(e, '云服务初始化失败')
      log('WARN', '云服务初始化失败：' + this.initError)
    }
  }

  /** 进程退出前把 token 落盘，避免每次启动都要重新登录 */
  async dispose(): Promise<void> {
    if (this.storage) await this.storage.flush()
  }

  // ---------------- 本机账号小档案（纯展示 / 预填，不参与鉴权） ----------------

  private readLocal(key: 'cloudNickname' | 'cloudAccountEmail' | 'cloudRememberAccount'): string {
    try {
      return readSetting(this.getDb(), key)
    } catch (e) {
      log('WARN', `读取本机设置 ${key} 失败：` + errorText(e, '未知错误'))
      return ''
    }
  }

  private writeLocal(
    key: 'cloudNickname' | 'cloudAccountEmail' | 'cloudRememberAccount',
    value: string
  ): void {
    try {
      writeSetting(this.getDb(), key, value)
    } catch (e) {
      // 写不进去最多是「下次不预填」，绝不能因此让一次已经成功的登录变成失败
      log('WARN', `写入本机设置 ${key} 失败：` + errorText(e, '未知错误'))
    }
  }

  /** 日志脱敏：abc@qq.com → a***@qq.com。日志里不许出现完整邮箱。 */
  private redactEmail(email: string): string {
    return maskEmail(email)
  }

  /**
   * 冷启动 + 断网时的兜底：直接读本机凭据文件里 SDK 存的那份会话。
   *
   * 适用场景：进程刚起来、内存缓存还是空的，而 token 恰好进入了续期窗口
   * （EXPIRY_MARGIN_MS = 90s）。此时 SDK 的 getSession() 会去续期、失败，然后
   * **不报错地返回 null**（它刻意保留了本地会话）。登录是强制的，若这里跟着
   * 判成未登录，断网就等于软件打不开。
   *
   * ⚠️ 只用于「我是谁」的展示与放行：不伪造会话、不回写 storage、不改 SDK 的
   * 续期冷却。云端读写该失败还是会失败，界面会如实显示 online:false。
   */
  private localSessionIdentity(): { userId: string | null; email: string | null; expiresAt: number } | null {
    if (!this.storage) return null
    // 键名不写死前缀：从 SDK 实际落过的键里挑（实测为
    // `workbuddy-cloud.session.<publishableKey>`，见 cloud-storage.keys() 的注释）
    const key = this.storage
      .keys()
      .find((k) => k.includes('session') && k.endsWith(CLOUD_PUBLISHABLE_KEY))
    if (!key) return null
    const raw = this.storage.getItem(key)
    if (!raw) return null
    try {
      const s = JSON.parse(raw) as Partial<CloudSession>
      return {
        expiresAt: typeof s.expiresAt === 'number' ? s.expiresAt : 0,
        userId: typeof s.user?.id === 'string' ? s.user.id : null,
        email: typeof s.user?.email === 'string' ? s.user.email : null
      }
    } catch (e) {
      log('WARN', '解析本机会话凭据失败：' + errorText(e, '未知错误'))
      return null
    }
  }

  /**
   * 冷启动即断网的兜底：本机凭据还没过期就按「已登录 + online:false」放行。
   *
   * 登录是强制的，这里不放行的话「断网」就等于「软件打不开」。拿不到有效凭据
   * 返回 null，由调用方按未登录处理。结果会写回 `cached`，后续刷新直接走缓存。
   */
  private offlineFromLocalCredential(): CloudStatus | null {
    const local = this.localSessionIdentity()
    if (!local || local.expiresAt <= Date.now()) return null
    const offline: CloudStatus = {
      available: true,
      signedIn: true,
      userId: local.userId,
      email: local.email,
      phone: null,
      accountName: this.localAccountName(),
      remoteUpdatedAt: null,
      remoteSummary: null,
      online: false,
      message: OFFLINE_CACHED
    }
    log('INFO', '断网冷启动，已使用本机保存的登录凭据放行')
    this.cached = offline
    return offline
  }

  private localAccountName(): string | null {
    const v = this.readLocal('cloudNickname').trim()
    return v || null
  }

  private unavailable(): CloudStatus {
    return {
      available: false,
      signedIn: false,
      userId: null,
      email: null,
      phone: null,
      accountName: this.localAccountName(),
      remoteUpdatedAt: null,
      remoteSummary: null,
      online: false,
      message: this.initError ?? '云服务未初始化'
    }
  }

  private anonymous(message: string, online = true): CloudStatus {
    return {
      available: true,
      signedIn: false,
      userId: null,
      email: null,
      phone: null,
      accountName: this.localAccountName(),
      remoteUpdatedAt: null,
      remoteSummary: null,
      online,
      message
    }
  }

  /** 读登录态 + 云端概况。断网时回退到内存快照，界面不会退化成「未登录」。 */
  async status(): Promise<CloudStatus> {
    if (!this.client) return this.unavailable()
    let session: CloudSession | null = null
    try {
      const r = await this.client.auth.getSession()
      if (r.error) throw r.error
      session = r.data
    } catch (e) {
      if (isNetworkish(e)) {
        // 有缓存就带缓存返回，但必须把 online 打成 false —— 界面靠它显示
        // 「云端暂时不可用」，而 signedIn 保持 true 才不会把人锁在门外。
        if (this.cached?.signedIn) {
          return { ...this.cached, online: false, message: NETWORK_DOWN }
        }
        if (this.cached) return { ...this.cached, online: false }
        return this.offlineFromLocalCredential() ?? this.anonymous(NETWORK_DOWN, false)
      }
      log('WARN', '读取云端会话失败：' + errorText(e, '未知错误'))
      return this.anonymous(describe(e, '读取登录状态失败'))
    }

    if (!session) {
      // ⚠️ 断网时 SDK 的 getSession() 会返回 {data:null, error:null} 而**不报错**
      // （续期失败但本地会话仍在，见 SDK session-manager.onRefreshFailed）。
      // 这里若直接判成未登录，一次网络抖动就会把已登录用户踢下线 —— 登录是强制的，
      // 那等于软件直接不可用。所以缓存里明明是已登录，就优先信缓存，只标 offline。
      if (this.cached?.signedIn) {
        return { ...this.cached, online: false, message: NETWORK_DOWN }
      }
      const offline = this.offlineFromLocalCredential()
      if (offline) return offline
      this.cached = this.anonymous('未登录')
      return this.cached
    }

    // 登录那一刻的 session.user 可能没有 email（上游按标识发码，未必回填），
    // 补一次 /v1/user/me；拿不到就保持原值，绝不能因此把已登录判成失败。
    let email: string | null = session.user?.email ?? null
    if (!email) {
      try {
        const u = await this.client.auth.getUser()
        if (u.data?.email) email = u.data.email
      } catch (e) {
        log('WARN', '补读用户邮箱失败（保持登录态）：' + errorText(e, '未知错误'))
      }
    }

    const base: CloudStatus = {
      available: true,
      signedIn: true,
      userId: session.user?.id ?? null,
      email,
      phone: session.user?.phone ?? null,
      accountName: this.localAccountName(),
      remoteUpdatedAt: null,
      remoteSummary: null,
      online: true,
      message: '已登录'
    }

    // 云端概况读失败不影响登录态本身：账号页照样显示已登录，只是没有"上次同步时间"
    try {
      const row = await this.fetchRow()
      if (row) {
        base.remoteUpdatedAt = row.updated_at ?? null
        const v = validateSnapshot(row.payload)
        base.remoteSummary = v.ok ? snapshotSummary(v.data) : null
        if (!v.ok) base.message = '云端数据版本不兼容：' + v.error
      }
    } catch (e) {
      if (isNetworkish(e)) {
        base.online = false
        base.message = '网络不可用，暂时无法读取云端配置'
      }
    }
    this.cached = base
    return base
  }

  private table(): CloudDatabase {
    return this.client!.database as unknown as CloudDatabase
  }

  private async fetchRow(): Promise<{ payload: unknown; updated_at?: string } | null> {
    const r = await this.table()
      .from('user_settings')
      .select('payload,updated_at')
      .eq('scope', CLOUD_SCOPE)
      .maybeSingle()
    if (r.error) throw r.error
    if (!r.data) return null
    return r.data as { payload: unknown; updated_at?: string }
  }

  /** 直连 auth 数据面（仅供忘记密码链路使用，理由见文件头注释） */
  private async postAuth(path: string, body: Record<string, unknown>): Promise<AuthHttpResult> {
    type Res = Awaited<ReturnType<typeof fetch>>
    let res: Res
    try {
      res = await fetch(AUTH_HTTP_BASE + path, {
        method: 'POST',
        // 走 authHeaders 而不是裸对象：直连同样会被服务端拒签令牌（缺 Origin）
        headers: authHeaders({
          'Content-Type': 'application/json',
          [AUTH_KEY_HEADER]: CLOUD_PUBLISHABLE_KEY
        }),
        body: JSON.stringify(body)
      })
    } catch (e) {
      return {
        data: null,
        error: {
          kind: 'network',
          message: `request failed before a response was received: ${errorText(e, String(e))}`,
          status: 0
        }
      }
    }
    let payload: unknown = null
    try {
      payload = await res.json()
    } catch {
      payload = null
    }
    if (!res.ok) {
      const rec = (payload ?? {}) as Record<string, unknown>
      const code = typeof rec.error === 'string' ? rec.error : undefined
      return {
        data: null,
        error: {
          kind: kindFromStatus(res.status),
          message: pickHttpMessage(payload, res.status),
          status: res.status,
          ...(code ? { code } : {})
        }
      }
    }
    return { data: (payload ?? {}) as Record<string, unknown>, error: null }
  }

  /**
   * 第一步：给邮箱发验证码（不产生会话）。
   *
   * usage='register' 走 SDK sendOtp（usage=email），返回值会顺带告诉我们邮箱是否已注册；
   * usage='reset' 走「忘记密码」专用发码（usage=PASSWORD_RESET / target=USER）。
   */
  async sendOtp(email: string, usage: 'register' | 'reset'): Promise<CloudOtpResult> {
    const bad = (message: string): CloudOtpResult => ({
      ok: false,
      message,
      verificationId: '',
      isExistingUser: false
    })
    const mail = (email ?? '').trim()
    const v = validateEmail(mail)
    if (!v.ok) return bad(v.message)
    if (!this.client) return bad(this.initError ?? '云服务未初始化')

    if (usage === 'reset') return this.sendResetOtp(mail, bad)

    try {
      const r = await this.client.auth.sendOtp({ email: mail })
      if (r.error) return bad(describe(r.error, '发送验证码失败'))
      return {
        ok: true,
        message: r.data.isExistingUser
          ? '验证码已发送，该邮箱已注册，可直接登录'
          : '验证码已发送，验证后自动创建账号',
        verificationId: r.data.verificationId,
        isExistingUser: r.data.isExistingUser
      }
    } catch (e) {
      return bad(describe(e, '发送验证码失败'))
    }
  }

  /** 忘记密码发码：直连，因为 SDK 只给闭包不给 verificationId（见文件头） */
  private async sendResetOtp(
    mail: string,
    bad: (m: string) => CloudOtpResult
  ): Promise<CloudOtpResult> {
    const r = await this.postAuth(AUTH_PATH_VERIFICATION, {
      email: mail,
      usage: 'PASSWORD_RESET',
      target: 'USER'
    })
    if (r.error) return bad(describe(r.error, '发送验证码失败'))
    const id = typeof r.data?.verification_id === 'string' ? r.data.verification_id : ''
    if (!id) {
      // 上游没给 id 时给出的是英文原文，这里按「服务不可用」统一文案
      return bad(describe({ kind: 'backend-unavailable', status: 502, message: '' }, '发送验证码失败'))
    }
    return {
      ok: true,
      message: '验证码已发送，请输入后重置密码',
      verificationId: id,
      // 重置密码只可能对已注册邮箱发起（target=USER），未注册会被上游拒绝
      isExistingUser: true
    }
  }

  /** 登录成功后的收尾：落盘 token → 回读会话 → 记本机账号档案 */
  private async finalizeSignIn(email: string): Promise<boolean> {
    await this.storage?.flush()
    try {
      const s = await this.client!.auth.getSession()
      if (s.error || !s.data) {
        log('WARN', '登录成功但回读会话失败：' + errorText(s.error, '会话为空'))
        return false
      }
    } catch (e) {
      log('WARN', '登录成功但回读会话失败：' + errorText(e, '未知错误'))
      return false
    }
    this.writeLocal('cloudAccountEmail', email)
    return true
  }

  /** 邮箱 + 密码登录 */
  async signIn(input: AccountSignInInput): Promise<CloudAuthResult> {
    const fail = async (message: string): Promise<CloudAuthResult> => ({
      ok: false,
      message,
      status: await this.status()
    })
    if (!this.client) {
      return { ok: false, message: this.initError ?? '云服务未初始化', status: this.unavailable() }
    }

    const email = (input?.email ?? '').trim()
    const password = typeof input?.password === 'string' ? input.password : ''

    const ev = validateEmail(email)
    if (!ev.ok) return fail(ev.message)
    if (!password) return fail('请输入密码')
    // 下限刻意不在这里卡：后端允许 4 位，老账号若有更短的密码不该被前端锁死，
    // 交给服务端判，届时命中「邮箱或密码不正确」。上限必须在本地卡住 ——
    // 超长会让后端把正则原文回给用户。
    if ([...password].length > PASSWORD_MAX) return fail(`密码最多 ${PASSWORD_MAX} 位`)

    try {
      const r = await this.client.auth.signInWithPassword({ email, password })
      if (r.error) return fail(describe(r.error, '登录失败'))
      if (!(await this.finalizeSignIn(email))) {
        return fail('登录成功但无法建立会话，请重试')
      }
      const remember = input?.remember === true
      this.writeLocal('cloudRememberAccount', remember ? '1' : '0')
      // 不记住就立刻清掉邮箱：勾选项取消后本机不该继续留着账号标识
      if (!remember) this.writeLocal('cloudAccountEmail', '')
      log('INFO', '云端登录成功：' + this.redactEmail(email))
      return { ok: true, message: '登录成功', status: await this.status() }
    } catch (e) {
      return fail(describe(e, '登录失败'))
    }
  }

  /** 注册：邮箱 + 验证码 + 密码（纯账号名+密码会被上游拒绝）。昵称只存本机展示。 */
  async signUp(input: AccountSignUpInput): Promise<CloudAuthResult> {
    const fail = async (message: string): Promise<CloudAuthResult> => ({
      ok: false,
      message,
      status: await this.status()
    })
    if (!this.client) {
      return { ok: false, message: this.initError ?? '云服务未初始化', status: this.unavailable() }
    }

    const nickname = normalizeNickname(input?.nickname ?? '')
    const email = (input?.email ?? '').trim()
    const password = typeof input?.password === 'string' ? input.password : ''
    const code = (input?.code ?? '').trim()
    const verificationId = (input?.verificationId ?? '').trim()

    const nv = validateNickname(nickname)
    if (!nv.ok) return fail(nv.message)
    const ev = validateEmail(email)
    if (!ev.ok) return fail(ev.message)
    const pv = validatePassword(password)
    if (!pv.ok) return fail(pv.message)
    const cv = validateCode(code)
    if (!cv.ok) return fail(cv.message)
    if (!verificationId) return fail('验证码已失效，请重新获取')

    // 验码不通过不是登录态失效，别把用户误导去"重新登录"
    const soft = async (e: unknown, fallback: string): Promise<CloudAuthResult> => {
      const m = describe(e, fallback)
      return fail(m === AUTH_EXPIRED ? '验证码不正确或已过期，请重新获取' : m)
    }

    try {
      const r = await this.client.auth.verifyOtp({
        verificationId,
        token: code,
        email,
        isExistingUser: false,
        password
      })
      if (r.error) return soft(r.error, '注册失败')
      if (!(await this.finalizeSignIn(email))) {
        return fail('注册成功但无法建立会话，请重试')
      }
      this.writeLocal('cloudNickname', nickname)
      this.writeLocal('cloudRememberAccount', '1')
      log('INFO', '云端注册成功：' + this.redactEmail(email))
      // 刻意不自动 push：注册完就上传一份快照不是用户此刻的意思表示
      return { ok: true, message: '注册成功，已自动登录', status: await this.status() }
    } catch (e) {
      return soft(e, '注册失败')
    }
  }

  /** 忘记密码：验码 → 重置 → 用新密码登录。三步分开，任何一步都能给用户准确反馈。 */
  async resetPassword(input: AccountResetInput): Promise<CloudAuthResult> {
    const fail = async (message: string): Promise<CloudAuthResult> => ({
      ok: false,
      message,
      status: await this.status()
    })
    if (!this.client) {
      return { ok: false, message: this.initError ?? '云服务未初始化', status: this.unavailable() }
    }

    const email = (input?.email ?? '').trim()
    const code = (input?.code ?? '').trim()
    const verificationId = (input?.verificationId ?? '').trim()
    const newPassword = typeof input?.newPassword === 'string' ? input.newPassword : ''

    const ev = validateEmail(email)
    if (!ev.ok) return fail(ev.message)
    const cv = validateCode(code)
    if (!cv.ok) return fail(cv.message)
    const pv = validatePassword(newPassword)
    if (!pv.ok) return fail(pv.message)
    if (!verificationId) return fail('验证码已失效，请重新获取')

    // 第一步：验证码换一次性 verification_token（它不是会话，不能拿去发请求）
    const verified = await this.postAuth(AUTH_PATH_VERIFICATION_VERIFY, {
      verification_id: verificationId,
      verification_code: code
    })
    if (verified.error) {
      const m = describe(verified.error, '验证码校验失败')
      return fail(m === AUTH_EXPIRED ? '验证码不正确或已过期，请重新获取' : m)
    }
    const token =
      typeof verified.data?.verification_token === 'string' ? verified.data.verification_token : ''
    if (!token) {
      return fail(describe({ kind: 'backend-unavailable', status: 502, message: '' }, '验证码校验失败'))
    }

    // 第二步：真正改密码。这一步成功就**已经重置成功**了。
    const reset = await this.postAuth(AUTH_PATH_RESET, {
      email,
      new_password: newPassword,
      verification_token: token
    })
    if (reset.error) return fail(describe(reset.error, '重置密码失败'))

    // 第三步：用自己的 signIn 登录，不走 SDK 的自动登录闭包。
    // 登录失败也**不能**报失败 —— 密码确实已经改了，报失败会让用户以为没改成功，
    // 然后再点一次「忘记密码」，白白吃掉一次发码额度。
    const signed = await this.signIn({ email, password: newPassword, remember: true })
    if (signed.ok) {
      log('INFO', '密码重置成功并已自动登录：' + this.redactEmail(email))
      return { ok: true, message: '密码已重置，已自动登录', status: signed.status }
    }
    log('WARN', '密码已重置但自动登录失败：' + signed.message)
    return { ok: true, message: '密码已重置，请用新密码登录', status: signed.status }
  }

  /** 已登录状态下改密码：旧密码做 sudo 校验。成功保持登录态，不 wipe、不 signOut。 */
  async changePassword(input: AccountChangePasswordInput): Promise<CloudSimpleResult> {
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化' }
    const oldPassword = typeof input?.oldPassword === 'string' ? input.oldPassword : ''
    const newPassword = typeof input?.newPassword === 'string' ? input.newPassword : ''
    if (!oldPassword) return { ok: false, message: '请输入当前密码' }
    const pv = validatePassword(newPassword)
    if (!pv.ok) return { ok: false, message: pv.message }

    const fail = (e: unknown): CloudSimpleResult => {
      if (isNetworkish(e)) return { ok: false, message: NETWORK_DOWN }
      if (isAuthFailure(e)) return { ok: false, message: AUTH_EXPIRED }
      // sudo 校验失败基本只有一种可能：旧密码不对。原文（英文）只进日志。
      log('WARN', '修改密码失败（原文）：' + errorText(e, '未知错误'))
      return { ok: false, message: '当前密码不正确，请重新输入' }
    }

    try {
      const r = await this.client.auth.resetPasswordForOld({ oldPassword, newPassword })
      if (r.error) return fail(r.error)
      // 保持登录态：只把（可能换过的）会话落盘，不清凭据、不登出
      await this.storage?.flush()
      log('INFO', '密码修改成功，已保持登录态')
      return { ok: true, message: '密码已修改' }
    } catch (e) {
      return fail(e)
    }
  }

  async signOut(): Promise<CloudSimpleResult> {
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化' }
    try {
      await this.client.auth.signOut()
    } catch (e) {
      // 断网也必须能登出：本地凭据照清，只是提示里说明服务端可能还挂着会话
      log('WARN', '云端登出请求失败（仍会清理本机凭据）：' + errorText(e, '未知错误'))
    }
    await this.storage?.wipe()
    // 昵称是纯展示数据，清了没意义（下次登录还要重新填）；邮箱由 remember 开关决定去留
    this.cached = this.anonymous('已退出登录')
    return { ok: true, message: '已退出登录' }
  }

  // ---------------- 配置快照 ----------------

  /** 上传：用本机数据覆盖云端。API Key 只在用户打开开关时才随 apiConfig 上云。 */
  async push(): Promise<CloudSyncResult> {
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化' }
    const snap = await buildSnapshot(this.getDb())
    const summary = snapshotSummary(snap)
    // 快照里带了 API 配置就必须让用户知道：密钥已经以明文离开本机
    const withApi = !!snap.apiConfig

    let userId: string | null = null
    try {
      const s = await this.client.auth.getSession()
      userId = s.data?.user?.id ?? null
    } catch {
      // 拿不到 uid 就让服务端用 auth.uid() 默认值兜底
    }

    const row: Record<string, unknown> = {
      scope: CLOUD_SCOPE,
      payload: snap,
      app_version: APP_VERSION,
      updated_at: new Date().toISOString()
    }
    if (userId) row.owner_id = userId

    try {
      const r = await this.table()
        .from('user_settings')
        .upsert(row, { onConflict: 'owner_id,scope' })
        .select('updated_at')
        .maybeSingle()
      if (r.error) return { ok: false, message: describe(r.error, '保存失败') }
      const updatedAt = (r.data as { updated_at?: string } | null)?.updated_at ?? new Date().toISOString()
      log(
        'INFO',
        `配置已保存到云端（术语库 ${summary.termLibs} 个 / 常用语 ${summary.phrases} 条` +
          (withApi ? '，含 API 配置（密钥已明文上传云端）' : '') +
          '）'
      )
      return {
        ok: true,
        message: withApi ? '已保存到云端（含 API 配置，密钥已明文上传）' : '已保存到云端',
        summary,
        updatedAt
      }
    } catch (e) {
      return { ok: false, message: describe(e, '保存失败') }
    }
  }

  /** 下载：用云端数据覆盖本机。覆盖前先做一份本地备份，随时能回滚。 */
  async pull(): Promise<CloudSyncResult> {
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化' }
    let row
    try {
      row = await this.fetchRow()
    } catch (e) {
      return { ok: false, message: describe(e, '读取云端配置失败') }
    }
    if (!row) return { ok: false, message: '云端还没有保存过配置，请先在本机点「保存到云端」' }

    const v = validateSnapshot(row.payload)
    if (!v.ok) return { ok: false, message: v.error }

    const db = this.getDb()
    // 覆盖是不可逆的，先在备份目录留一份现场
    try {
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
      createBackup(this.root, db, `before-cloud-pull-${stamp}.db`)
    } catch (e) {
      log('WARN', '云端同步前的本地备份失败：' + errorText(e, '未知错误'))
    }

    const snap = v.data
    try {
      await applySnapshot(db, snap)
    } catch (e) {
      return { ok: false, message: '写入本机失败：' + errorText(e, '未知错误') }
    }
    invalidateTermCache()
    return {
      ok: true,
      message: snap.apiConfig
        ? '已用云端配置覆盖本机（含 API 配置，覆盖前的本机数据已备份）'
        : '已用云端配置覆盖本机（覆盖前的本机数据已备份）',
      summary: snapshotSummary(snap),
      updatedAt: row.updated_at
    }
  }

  /** 删除云端保存的配置（不影响本机数据，也不退出登录） */
  async removeRemote(): Promise<CloudSimpleResult> {
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化' }
    try {
      const r = await this.table().from('user_settings').delete().eq('scope', CLOUD_SCOPE)
      if (r.error) return { ok: false, message: describe(r.error, '删除云端配置失败') }
      return { ok: true, message: '已删除云端配置（本机数据未改动）' }
    } catch (e) {
      return { ok: false, message: describe(e, '删除失败') }
    }
  }

  /** 供界面展示：本机当前将要上传的内容有多少 */
  async localSummary(): Promise<CloudSummary> {
    return snapshotSummary(await buildSnapshot(this.getDb()))
  }

  snapshotVersion(): number {
    return CLOUD_SNAPSHOT_VERSION
  }
}
