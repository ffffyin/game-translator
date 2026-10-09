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
import { dpapiEncrypt, dpapiDecrypt, clearDpapiCache } from './crypto'
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
  insert(rows: Record<string, unknown>): CloudQuery
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
const NETWORK_DOWN = '网络不可用，暂时无法连接云端'
/**
 * 断网且本次进程没有成功在线登录过时的提示。
 *
 * 现在的策略是**离线打不开软件**（为将来的授权/付费校验留出强制联网的口子）：
 * 没有通过云端验证就没有会话，一律拦在登录页。旧版「凭本机会话离线放行」的
 * 兜底已经废掉，别再往回改。
 */
const OFFLINE_NEED_LOGIN = '网络不可用，离线状态下无法登录，请联网后重试'
/** 每次启动的默认落点：不开启自动登录就必须重新登录 */
const PLEASE_SIGN_IN = '请登录'
/** 自动登录失败（密码改过 / 账号异常 / 服务不可用）的统一提示 */
const AUTO_LOGIN_FAILED = '自动登录失败，请重新输入密码'
/** 保存的密码已经不对了（用户在别处改过密码）：把原因点明，别让人怀疑软件坏了 */
const AUTO_LOGIN_FAILED_PASSWORD = '自动登录失败：保存的密码已失效，请重新输入密码'
/** 自动登录时网络不通：原因必须说清，否则用户会以为账号出了问题 */
const AUTO_LOGIN_OFFLINE = '网络不可用，无法自动登录，请联网后重试'
/** 本机密码密文解不开（换电脑 / 换系统 / DPAPI 不可用时） */
const AUTO_LOGIN_UNREADABLE = '自动登录失败：本机保存的密码已无法读取，请重新输入密码'
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

/**
 * 本机账号小档案允许读写的键。
 *
 * 全部都是**本机键** —— 一个都不在 `CLOUD_SETTING_KEYS` 白名单里，不会随快照上云。
 * 尤其是 `cloudSavedPassword`：那是 DPAPI 密文，一旦同步到云端等于把密码明文交出去。
 */
type LocalAccountKey =
  | 'cloudNickname'
  | 'cloudAccountEmail'
  | 'cloudRememberAccount'
  | 'cloudSavePassword'
  | 'cloudAutoLogin'
  | 'cloudSavedPassword'

export class CloudService {
  private client: WorkBuddyCloudClient | null = null
  private storage: SecureAuthStorage | null = null
  private initError: string | null = null
  private initPromise: Promise<void> | null = null
  // 断网时仍要能显示「上次是谁登录的」：状态在内存里留一份快照
  private cached: CloudStatus | null = null
  // 一个进程只发一次 boot 流水：status() 会被界面反复轮询，每刷一次插一行
  // 会把「今日登录用户数」冲成虚高（同一人反复开机 = 多条）。
  private bootEventSent = false
  /**
   * 本次进程内是否发生过一次**成功的在线登录**（手动登录 / 注册 / 自动登录都算）。
   *
   * 这是「用户确实通过云端验证过」的唯一证据。判定能不能用软件只看它：
   *  - 为真 + 之后掉线 → 仍算已登录（人刚验过身份，不该被一次抖动踢出去）；
   *  - 为假 + 本机会话还在 → **一律按未登录处理**（每次启动都要重新登录）。
   *
   * 反过来不能只看「本机有没有会话文件」：那样只要不清凭据就能永久离线使用，
   * 与「离线打不开软件」这条产品策略冲突。
   */
  private onlineLoginOk = false

  constructor(
    private readonly root: string,
    private readonly getDb: () => Db
  ) {}

  async init(): Promise<void> {
    if (this.client) return
    // 同一时刻只跑一次初始化。init() 是异步的、失败还会清空 client，
    // 两个并发调用会各自建一个 SDK 实例、互相覆盖会话（「为另一个客户端签发」多半就是这么来的）。
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInit()
    return this.initPromise
  }

  private async doInit(): Promise<void> {
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
      // 关键：失败时必须把 client 置空，否则会留下一个 storage 未接上的半成品实例，
      // 后面所有 auth 调用都会以
      // "the session is invalid, expired or issued for another client" 被服务端拒绝，
      // 而真正的失败原因（这里）早已被吞掉，排查时会被这个误导性报错带偏。
      this.client = null
      this.storage = null
    }
  }

  /** 初始化失败时主动重试一次；已成功则直接返回，不会重复建实例。 */
  async retryInit(): Promise<void> {
    if (this.client) return
    this.initError = null
    this.initPromise = null
    await this.init()
  }

  /** 进程退出前把 token 落盘，避免每次启动都要重新登录 */
  async dispose(): Promise<void> {
    if (this.storage) await this.storage.flush()
  }

  // ---------------- 本机账号小档案（纯展示 / 预填，不参与鉴权） ----------------

  private readLocal(key: LocalAccountKey): string {
    try {
      return readSetting(this.getDb(), key)
    } catch (e) {
      log('WARN', `读取本机设置 ${key} 失败：` + errorText(e, '未知错误'))
      return ''
    }
  }

  private writeLocal(key: LocalAccountKey, value: string): void {
    try {
      writeSetting(this.getDb(), key, value)
    } catch (e) {
      // 写不进去最多是「下次不预填」，绝不能因此让一次已经成功的登录变成失败
      log('WARN', `写入本机设置 ${key} 失败：` + errorText(e, '未知错误'))
    }
  }

  // ---------------- 本机保存的密码（DPAPI 密文，绝不明文落盘） ----------------

  /**
   * 把密码加密后存进本机设置。
   *
   * 失败一律降级成「没有保存」：存密码只是便利功能，绝不能让一次已经成功的
   * 登录被它拖成失败。同时把开关也拨回 0，避免界面显示「已保存」但取不出来。
   */
  private async savePasswordLocal(password: string): Promise<void> {
    try {
      const cipher = await dpapiEncrypt(password)
      if (!cipher) throw new Error('DPAPI 返回了空密文')
      this.writeLocal('cloudSavedPassword', cipher)
      this.writeLocal('cloudSavePassword', '1')
    } catch (e) {
      log('WARN', '保存本机密码失败（已按未保存处理）：' + errorText(e, '未知错误'))
      this.writeLocal('cloudSavedPassword', '')
      this.writeLocal('cloudSavePassword', '0')
    }
  }

  /**
   * 清除本机保存的密码并关闭自动登录。
   *
   * 三个调用点，缺一个都是一致性漏洞：
   *  1. 用户在登录页取消「保存密码」；
   *  2. 退出登录（不清的话下次又自动登进来，等于退不掉）；
   *  3. 修改密码成功（旧密码已失效，留着只会让下次自动登录必失败）。
   */
  private clearSavedPassword(): void {
    this.writeLocal('cloudSavedPassword', '')
    this.writeLocal('cloudSavePassword', '0')
    this.writeLocal('cloudAutoLogin', '0')
    // 解密缓存里可能还留着这条密文解出来的明文（纯内存），一并清掉
    clearDpapiCache()
  }

  /**
   * 取回本机保存的密码明文。
   *
   * @returns 空串=本机没存过；`null`=存过但解不出来（换电脑 / 换 Windows 用户 /
   *          DPAPI 被安全软件拦了）。这两者必须分开：前者是正常状态，后者要清密文。
   */
  private async readSavedPassword(): Promise<string | null> {
    const cipher = this.readLocal('cloudSavedPassword').trim()
    if (!cipher) return ''
    try {
      return await dpapiDecrypt(cipher)
    } catch (e) {
      // 日志里只说「读不出来」，绝不能带密文或明文
      log('WARN', '读取本机保存的密码失败：' + errorText(e, '未知错误'))
      return null
    }
  }

  /** 日志脱敏：abc@qq.com → a***@qq.com。日志里不许出现完整邮箱。 */
  private redactEmail(email: string): string {
    return maskEmail(email)
  }

  /**
   * 只清本机凭据与登录态，**不触碰服务端会话**。
   *
   * 与 `signOut()` 的区别就在这一点：启动重置、自动登录失败后的收敛都只该
   * 清本地（调用远端 signOut 会让「断网启动」这种最常见场景直接卡住）。
   *
   * 清不掉文件也要把内存态置为未登录 —— 登出的语义是「不能再用」，不是文件必须消失。
   */
  private async clearLocalSession(message: string): Promise<CloudStatus> {
    try {
      await this.storage?.wipe()
    } catch (e) {
      log('WARN', '清理本机登录凭据失败（仍按未登录处理）：' + errorText(e, '未知错误'))
    }
    this.onlineLoginOk = false
    this.cached = this.anonymous(message)
    return this.cached
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

  /**
   * 读登录态 + 云端概况。
   *
   * 判定原则（2026-10-09 起生效，取代旧的「离线兜底」）：
   *  **每次启动都需要重新登录；离线打不开软件。**
   *  只有「本次进程内成功在线登录过」（`onlineLoginOk`）才可能得到 signedIn=true。
   *  唯一例外是自动登录开关打开且本次自动登录真的拿到了云端会话 —— 那也是一次
   *  真实的在线登录，只是不需要用户动手。
   *
   * 这里刻意只做一件事：它是「已登录」结论的唯一公共出口，boot 流水就挂在这里。
   * status() 有多条分支会走到 signedIn=true，在每条分支里各插一次既容易漏也容易
   * 重复，挂在出口上一处覆盖全部。
   */
  async status(): Promise<CloudStatus> {
    const s = await this.readStatus()
    if (s.signedIn) void this.recordEvent('boot')
    return s
  }

  /**
   * 启动门控：渲染层起来后**第一个**调用的云端接口，决定这一趟能不能直接进软件。
   *
   * 规则（对应「每次打开都要重新登录，但可以选择保存密码和自动登录」）：
   *  1. 未开启 `cloudAutoLogin` → 清掉本机会话，返回未登录。即使会话没过期也清，
   *     这就是「每次打开都停在登录页」的实现方式；
   *  2. 开启但缺邮箱或缺密码密文 → 关掉自动登录，返回未登录；
   *  3. 密文解不开（换机器 / 换系统 / DPAPI 不可用）→ 清掉密文与开关再返回未登录，
   *     否则每次启动都会白试一次，永远进不去也永远不报错；
   *  4. 有凭据 → **走真实网络**调 signIn。成功才算已登录；断网 / 密码改过 / 任何
   *     失败都回登录页，并把原因说清楚（断网和「密码失效」是两回事）。
   *
   * ⚠️ 全程只清本地，不调远端 signOut：本方法最常见的触发场景恰恰是断网启动。
   */
  async prepareBoot(): Promise<CloudStatus> {
    // 初始化失败时再给一次机会：DPAPI 解密要走一次 PowerShell，冷启动偶发超时/被杀，
    // 若就这么把"云端不可用"钉死，用户会一直登不进去。重试仍有节流（见 retryInit）。
    if (!this.client) await this.retryInit()
    if (!this.client) return this.unavailable()

    if (this.readLocal('cloudAutoLogin') !== '1') {
      return this.clearLocalSession(PLEASE_SIGN_IN)
    }

    const email = this.readLocal('cloudAccountEmail').trim()
    const cipher = this.readLocal('cloudSavedPassword').trim()
    if (!email || !cipher) {
      // 开关开着却没有凭据（用户清过数据 / 只勾了开关就退出）：别反复空转
      this.writeLocal('cloudAutoLogin', '0')
      return this.clearLocalSession(PLEASE_SIGN_IN)
    }

    const password = await this.readSavedPassword()
    if (password === null) {
      this.clearSavedPassword()
      return this.clearLocalSession(AUTO_LOGIN_UNREADABLE)
    }
    if (!password) {
      this.writeLocal('cloudAutoLogin', '0')
      return this.clearLocalSession(PLEASE_SIGN_IN)
    }

    // 自动登录隐含保存密码：这里显式传 true，避免它被下一次手动登录的开关带偏
    const r = await this.signIn({
      email,
      password,
      remember: true,
      savePassword: true,
      autoLogin: true
    })
    if (r.ok) {
      log('INFO', '自动登录成功，已进入软件：' + this.redactEmail(email))
      return r.status
    }
    log('WARN', `自动登录失败（${r.message}），已回到登录页`)
    return this.clearLocalSession(this.autoLoginFailure(r.message))
  }

  /**
   * 登录框预填用的密码明文（**只进内存，不落盘、不进日志**）。
   *
   * 刻意只在「保存密码开着、自动登录没开」时才返回：开着自动登录的话启动就该直接
   * 登进去了，真停在登录页说明自动登录刚失败（断网 / 密码失效），此时把密码摊在
   * 界面上既没用也不安全。
   *
   * @returns 密码明文；不满足条件或密文解不开时返回空串。
   */
  async takeSavedPassword(): Promise<string> {
    if (this.readLocal('cloudSavePassword') !== '1') return ''
    if (this.readLocal('cloudAutoLogin') === '1') return ''
    const pwd = await this.readSavedPassword()
    return pwd ?? ''
  }

  /**
   * 用户在界面上取消「保存密码」：立刻删掉本机密文并关掉自动登录。
   *
   * 单独开一个接口而不复用 signIn 的入参，是因为取消勾选这个动作**不一定**伴随一次
   * 登录 —— 勾掉就必须马上生效，本机不能留残余密文。
   */
  forgetSavedPassword(): CloudSimpleResult {
    this.clearSavedPassword()
    return { ok: true, message: '已清除本机保存的密码' }
  }

  /** 把自动登录的失败原因翻译成人话：断网和「密码失效」对用户是完全不同的两件事 */
  private autoLoginFailure(raw: string): string {
    if (!raw) return AUTO_LOGIN_FAILED
    if (raw === NETWORK_DOWN || raw.includes('网络不可用')) return AUTO_LOGIN_OFFLINE
    if (raw === BAD_CREDENTIALS) return AUTO_LOGIN_FAILED_PASSWORD
    return AUTO_LOGIN_FAILED
  }

  /** status() 的实现本体：只判定登录态，不碰埋点。 */
  private async readStatus(): Promise<CloudStatus> {
    if (!this.client) await this.retryInit()
    if (!this.client) return this.unavailable()
    let session: CloudSession | null = null
    try {
      const r = await this.client.auth.getSession()
      if (r.error) throw r.error
      session = r.data
    } catch (e) {
      if (isNetworkish(e)) {
        // 掉线放行**只**留给「本次已经在线登录成功过」的情况：人刚验过身份，
        // 不该被一次网络抖动挡在门外。除此之外断网就是未登录。
        if (this.cached?.signedIn && this.onlineLoginOk) {
          return { ...this.cached, online: false, message: NETWORK_DOWN }
        }
        this.cached = this.anonymous(OFFLINE_NEED_LOGIN, false)
        return this.cached
      }
      log('WARN', '读取云端会话失败：' + errorText(e, '未知错误'))
      return this.anonymous(describe(e, '读取登录状态失败'))
    }

    if (!session) {
      // ⚠️ 断网时 SDK 的 getSession() 会返回 {data:null, error:null} 而**不报错**
      // （续期失败但本地会话仍在，见 SDK session-manager.onRefreshFailed）。
      // 同样只在「本次在线登录成功过」时才信缓存。
      if (this.cached?.signedIn && this.onlineLoginOk) {
        return { ...this.cached, online: false, message: NETWORK_DOWN }
      }
      this.cached = this.anonymous(this.onlineLoginOk ? '未登录' : PLEASE_SIGN_IN)
      return this.cached
    }

    // 本机会话还在、但本次启动没有一次成功的在线登录 → 一律按未登录处理。
    // 这是「每次打开都要重新登录」的最后一道闸：SDK 内存里可能还留着上次那份
    // 会话（storage 被 wipe 后它不一定同步清掉），只看 session 非空会漏过去。
    if (!this.onlineLoginOk) {
      this.cached = this.anonymous(PLEASE_SIGN_IN)
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

  /**
   * 登录/启动流水。纯统计用，成败都不许影响登录 —— 所以这里自己吞掉所有异常。
   *
   * 云端目前只有 user_settings（RLS 行级权限，用户只能读写自己那行），
   * 「多少注册用户、今日多少用户登录」没有任何服务端数据源，只能靠客户端埋点。
   *
   * ⚠️ owner_id 由服务端 DEFAULT auth.uid() 填，客户端不许传：
   * login_events 的 INSERT 策略是 WITH CHECK (owner_id = auth.uid())，
   * 客户端自己带一个（哪怕是正确的值）也照样被 RLS 拒。
   *
   * @param kind login=登录成功 / register=注册成功 / boot=确认已登录（进程内一次）
   */
  private async recordEvent(kind: 'login' | 'register' | 'boot'): Promise<void> {
    // boot 只在进程内发一次：见字段 bootEventSent 的注释
    if (kind === 'boot') {
      if (this.bootEventSent) return
    }
    if (!this.client) return
    if (kind === 'boot') this.bootEventSent = true
    try {
      const r = await this.table()
        .from('login_events')
        .insert({ kind, app_version: APP_VERSION })
      // 成功不落 INFO：每次登录都写一行日志没有信息量，只会把 main.log 冲淡
      if (r?.error) {
        log('WARN', `登录流水写入失败（${kind}）：` + errorText(r.error, '未知错误'))
      }
    } catch (e) {
      log('WARN', `登录流水写入失败（${kind}）：` + errorText(e, '未知错误'))
    }
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
      // 走到这里就是一次真正的云端验证：之后即使掉线也认这个身份
      this.onlineLoginOk = true

      const remember = input?.remember === true
      // 自动登录必须有密码，所以勾了它就等同于勾了「保存密码」
      const autoLogin = input?.autoLogin === true
      const savePassword = autoLogin || input?.savePassword === true

      this.writeLocal('cloudRememberAccount', remember ? '1' : '0')
      // 不记住就立刻清掉邮箱：勾选项取消后本机不该继续留着账号标识
      if (!remember) this.writeLocal('cloudAccountEmail', '')
      // 不记住邮箱就没有自动登录的凭据（不知道该用哪个账号登），连带清掉密码与开关
      if (!remember || !savePassword) this.clearSavedPassword()
      else await this.savePasswordLocal(password)
      this.writeLocal('cloudAutoLogin', autoLogin && savePassword && remember ? '1' : '0')

      // 纯统计，失败也不许拖累这次登录
      void this.recordEvent('login')
      // ⚠️ 日志里只出现脱敏邮箱，密码一个字都不许打
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
      // 注册即登录：同样是一次真实的云端验证，掉线后要认这个身份
      this.onlineLoginOk = true
      // 注册不替用户打开「保存密码 / 自动登录」—— 那两个必须由他自己勾选
      this.clearSavedPassword()
      // 纯统计，失败也不许拖累这次注册（账号已经建好了）
      void this.recordEvent('register')
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
    //
    // 保存密码 / 自动登录按**本机已有的开关**走：找回密码是应急入口，不该顺手替
    // 用户打开「保存密码」。只有他本来就开着自动登录，才把新密码回写进去，
    // 否则下次启动还会拿旧密码去自动登录、必然失败。
    const autoLogin = this.readLocal('cloudAutoLogin') === '1'
    const signed = await this.signIn({
      email,
      password: newPassword,
      remember: true,
      savePassword: autoLogin,
      autoLogin
    })
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
      // 旧密码此刻已经失效：本机保存的那份留着只会让下次自动登录必然失败
      this.clearSavedPassword()
      log('INFO', '密码修改成功，已保持登录态（已清除本机保存的密码）')
      return {
        ok: true,
        message: '密码已修改，已清除本机保存的密码，如需自动登录请重新登录并勾选'
      }
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
    // 昵称是纯展示数据，清了没意义（下次登录还要重新填）；邮箱由 remember 开关决定去留。
    // 保存的密码与自动登录**必须**一起清：否则用户点退出，下次启动又被自动登进来，
    // 等于永远退不掉。
    this.clearSavedPassword()
    this.onlineLoginOk = false
    this.cached = this.anonymous('已退出登录')
    return { ok: true, message: '已退出登录，本机保存的密码已清除' }
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
