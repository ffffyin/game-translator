import { join } from 'path'
import { app } from 'electron'
import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import type { WorkBuddyCloudClient } from '@tencent-ai/workbuddy-cloud-sdk'
import type { Db } from './db-wrapper'
import { SecureAuthStorage } from './cloud-storage'
import { buildSnapshot, applySnapshot } from './cloud-snapshot'
import { createBackup } from './backup'
import { invalidateTermCache } from './term-cache'
import { log } from './logger'
import { APP_VERSION } from '../../shared/version'
import {
  CLOUD_SCOPE,
  CLOUD_SNAPSHOT_VERSION,
  snapshotSummary,
  validateSnapshot,
  type CloudStatus,
  type CloudSyncResult,
  type CloudSimpleResult,
  type CloudSummary
} from '../../shared/cloud'

// 云服务配置：publishableKey 只标识「哪个应用」，本身不携带权限，
// 可以随客户端分发；真正的拦截在服务端（RLS：owner_id = auth.uid()）。
const CLOUD_ENDPOINT = 'https://game-translator.app.workbuddy.host'
const CLOUD_PUBLISHABLE_KEY = 'wbpk_j7gSzC4Hd9cFphl7a2wJmo_wLuzfc9Zh2tvfBUXpw1FiIEZJQe6OUfO'
const CLOUD_OAUTH_RELAY = 'https://www.workbuddy.cn/v2/as/genie-baas/oauth'

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

function describe(e: unknown, fallback: string): string {
  if (isNetworkish(e)) return '网络不可用，暂时无法连接云端（本地功能不受影响）'
  if (isAuthFailure(e)) return AUTH_EXPIRED
  return errorText(e, fallback)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
        storage
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

  private unavailable(): CloudStatus {
    return {
      available: false,
      signedIn: false,
      userId: null,
      email: null,
      phone: null,
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
      remoteUpdatedAt: null,
      remoteSummary: null,
      online,
      message
    }
  }

  /** 读登录态 + 云端概况。断网时回退到内存快照，界面不会退化成「未登录」。 */
  async status(): Promise<CloudStatus> {
    if (!this.client) return this.unavailable()
    let session
    try {
      const r = await this.client.auth.getSession()
      if (r.error) throw r.error
      session = r.data
    } catch (e) {
      if (isNetworkish(e)) {
        return (
          this.cached ?? this.anonymous('网络不可用，暂时无法连接云端（本地功能不受影响）', false)
        )
      }
      log('WARN', '读取云端会话失败：' + errorText(e, '未知错误'))
      return this.anonymous(errorText(e, '读取登录状态失败'))
    }

    if (!session) {
      this.cached = this.anonymous('未登录')
      return this.cached
    }

    const base: CloudStatus = {
      available: true,
      signedIn: true,
      userId: session.user?.id ?? null,
      email: session.user?.email ?? null,
      phone: session.user?.phone ?? null,
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

  /** 第一步：给邮箱发验证码（不产生会话）。服务端会顺带告诉我们这个邮箱是否已注册。 */
  async sendOtp(
    email: string
  ): Promise<{ ok: boolean; message: string; verificationId: string; isExistingUser: boolean }> {
    const mail = email.trim()
    if (!EMAIL_RE.test(mail)) return { ok: false, message: '请输入正确的邮箱地址', verificationId: '', isExistingUser: false }
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化', verificationId: '', isExistingUser: false }
    try {
      const r = await this.client.auth.sendOtp({ email: mail })
      if (r.error) return { ok: false, message: describe(r.error, '发送验证码失败'), verificationId: '', isExistingUser: false }
      return {
        ok: true,
        message: r.data.isExistingUser ? '验证码已发送，请输入后登录' : '验证码已发送，验证后自动创建账号',
        verificationId: r.data.verificationId,
        isExistingUser: r.data.isExistingUser
      }
    } catch (e) {
      return { ok: false, message: describe(e, '发送验证码失败'), verificationId: '', isExistingUser: false }
    }
  }

  /** 第二步：验码登录/注册。成功后立刻落盘 token，并回读一次状态。 */
  async verifyOtp(input: {
    email: string
    verificationId: string
    token: string
    isExistingUser: boolean
  }): Promise<{ ok: boolean; message: string; status: CloudStatus }> {
    if (!this.client) {
      return { ok: false, message: this.initError ?? '云服务未初始化', status: this.unavailable() }
    }
    const email = input.email.trim()
    const code = input.token.trim()
    if (!EMAIL_RE.test(email)) return { ok: false, message: '邮箱地址不正确，请重新获取验证码', status: await this.status() }
    if (!/^\d{4,8}$/.test(code)) return { ok: false, message: '验证码为 4~8 位数字', status: await this.status() }
    if (!input.verificationId) return { ok: false, message: '验证码已失效，请重新获取', status: await this.status() }

    try {
      const r = await this.client.auth.verifyOtp({
        verificationId: input.verificationId,
        token: code,
        email,
        isExistingUser: input.isExistingUser
      })
      if (r.error) {
        const m = describe(r.error, '验证码校验失败')
        // 验证码错/过期不是登录态失效，别把用户误导去"重新登录"
        return {
          ok: false,
          message: m === AUTH_EXPIRED ? '验证码不正确或已过期，请重新获取' : m,
          status: await this.status()
        }
      }
      await this.storage?.flush()
      log('INFO', `云端登录成功：${email}`)
      return { ok: true, message: '登录成功', status: await this.status() }
    } catch (e) {
      return { ok: false, message: describe(e, '登录失败'), status: await this.status() }
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
    this.cached = this.anonymous('已退出登录')
    return { ok: true, message: '已退出登录' }
  }

  // ---------------- 配置快照 ----------------

  /** 上传：用本机数据覆盖云端。API Key / 模型配置 / 用量 / 备份都不参与。 */
  async push(): Promise<CloudSyncResult> {
    if (!this.client) return { ok: false, message: this.initError ?? '云服务未初始化' }
    const snap = buildSnapshot(this.getDb())
    const summary = snapshotSummary(snap)

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
      log('INFO', `配置已保存到云端（术语库 ${summary.termLibs} 个 / 常用语 ${summary.phrases} 条）`)
      return { ok: true, message: '已保存到云端', summary, updatedAt }
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
      applySnapshot(db, snap)
    } catch (e) {
      return { ok: false, message: '写入本机失败：' + errorText(e, '未知错误') }
    }
    invalidateTermCache()
    return {
      ok: true,
      message: '已用云端配置覆盖本机（覆盖前的本机数据已备份）',
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
  localSummary(): CloudSummary {
    return snapshotSummary(buildSnapshot(this.getDb()))
  }

  snapshotVersion(): number {
    return CLOUD_SNAPSHOT_VERSION
  }
}
