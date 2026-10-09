// 锁死新的登录策略（2026-10-09 起）：
//   **每次启动都需要重新登录；离线打不开软件。**
//   只有「本次进程内成功在线登录过」才算已登录 —— 本机会话文件、SDK 内存会话都不算。
//   想省事的用户可以勾「保存密码 + 自动登录」，由 prepareBoot() 在启动时代跑一次
//   真实联网登录；那一步失败（断网 / 密码改过 / 密文解不开）一律回登录页。
//
// 同时锁住密码的三条底线：
//   1. 落盘的一律是密文（走 DPAPI），绝不明文；
//   2. 取消勾选 / 退出登录 / 改密后本机不留残余密文；
//   3. 密码绝不进日志。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync } from 'fs'

// CloudService 构造时不需要 electron，但模块顶层 import 了 app —— node 环境下
// 这个包只导出一个二进制路径字符串，取 .on 会炸，所以这里直接替掉。
vi.mock('electron', () => ({ app: { on: (): void => undefined } }))

// 用一份可逆的假「DPAPI」替掉 PowerShell 那条路：单测不该 fork 进程，
// 而「存进去的是密文、取出来是明文」这件事必须能来回验证。
const cryptoCtl = vi.hoisted(() => ({ failDecrypt: false }))
vi.mock('../../src/main/services/crypto', () => ({
  dpapiEncrypt: async (plain: string): Promise<string> =>
    `ENC:${Buffer.from(plain, 'utf8').toString('base64')}`,
  dpapiDecrypt: async (cipher: string): Promise<string> => {
    if (cryptoCtl.failDecrypt) throw new Error('DPAPI 解不开（换了 Windows 用户）')
    if (!cipher.startsWith('ENC:')) throw new Error('不是本软件写的密文')
    return Buffer.from(cipher.slice(4), 'base64').toString('utf8')
  },
  clearDpapiCache: (): void => undefined
}))

// 抓住每一条日志：最后要断言密码一个字都没混进去
const logCalls = vi.hoisted(() => [] as Array<unknown[]>)
vi.mock('../../src/main/services/logger', () => ({
  log: (...args: unknown[]): void => {
    logCalls.push(args)
  }
}))

import { CloudService } from '../../src/main/services/cloud'
import { SecureAuthStorage } from '../../src/main/services/cloud-storage'
import { applyMigrations } from '../../src/main/db/schema'
import { Db } from '../../src/main/services/db-wrapper'
import { readSetting } from '../../src/main/services/settings'

const PASSWORD = 'Str0ng!Pass'
const MAIL = 'me@example.com'

interface FakeAuthOpts {
  /** 让 signInWithPassword 抛网络错（模拟断网） */
  netDown?: boolean
  /** 只有这个密码能登录成功；不传表示任何密码都收 */
  expectPassword?: string
  /** SDK 内存里还留着上次那份会话（storage 被 wipe 后它不一定同步清掉） */
  hasLiveSession?: boolean
}

const SESSION = {
  accessToken: 'at',
  refreshToken: 'wbrt_1',
  expiresAt: Date.now() + 3600_000,
  user: { id: 'u-1', email: MAIL, isAnonymous: false }
}

function fakeAuth(o: FakeAuthOpts = {}): Record<string, unknown> {
  let current: typeof SESSION | null = o.hasLiveSession ? SESSION : null
  return {
    signInWithPassword: async ({ password }: { password: string }) => {
      if (o.netDown) throw { kind: 'network', message: 'fetch failed', status: 0 }
      if (o.expectPassword && password !== o.expectPassword) {
        return {
          data: null,
          error: {
            kind: 'invalid-request',
            status: 400,
            code: 'INVALID_USERNAME_OR_PASSWORD',
            message: 'Username or password incorrect.'
          }
        }
      }
      current = SESSION
      return { data: { session: SESSION }, error: null }
    },
    getSession: async () => ({ data: current, error: null }),
    getUser: async () => ({ data: SESSION.user, error: null }),
    signOut: async () => {
      current = null
      return { data: null, error: null }
    },
    resetPasswordForOld: async () => ({ data: null, error: null }),
    onAuthStateChange: () => () => undefined
  }
}

/** 云端读写一律成功但不留数据：这几条路径不是本文件的被测对象 */
function fakeDatabase(): Record<string, unknown> {
  const done = Promise.resolve({ data: null, error: null })
  const q: Record<string, unknown> = {}
  const self = (): Record<string, unknown> => q
  q.select = self
  q.eq = self
  q.maybeSingle = self
  q.insert = self
  q.upsert = self
  q.delete = self
  q.then = (onF?: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) =>
    done.then(onF as never, onR as never)
  return { from: () => q }
}

type Mutable = {
  client: unknown
  cached: unknown
  initError: string | null
  storage: SecureAuthStorage | null
  onlineLoginOk: boolean
}

const opened: Db[] = []

function newService(auth: Record<string, unknown>, withStorage = true): {
  svc: CloudService
  db: Db
  storage: SecureAuthStorage | null
} {
  const db = new Db(':memory:')
  applyMigrations(db)
  opened.push(db)
  const storage = withStorage
    ? new SecureAuthStorage(join(tmpdir(), `gt-boot-${Date.now()}-${Math.random()}.enc`))
    : null
  const svc = new CloudService('', () => db)
  const m = svc as unknown as Mutable
  m.client = { auth, database: fakeDatabase() }
  m.cached = null
  m.initError = null
  m.storage = storage
  m.onlineLoginOk = false
  return { svc, db, storage }
}

/** 直接读本机设置键（绕过 CloudService 的私有方法） */
function local(db: Db, key: 'cloudAccountEmail' | 'cloudAutoLogin' | 'cloudSavePassword' | 'cloudSavedPassword'): string {
  return readSetting(db, key)
}

/** 造一份「用户已经勾选保存密码并成功登录过」的本机状态 */
async function seedAutoLogin(db: Db, password = PASSWORD): Promise<void> {
  const { writeSetting } = await import('../../src/main/services/settings')
  writeSetting(db, 'cloudRememberAccount', '1')
  writeSetting(db, 'cloudAccountEmail', MAIL)
  writeSetting(db, 'cloudSavePassword', '1')
  writeSetting(db, 'cloudAutoLogin', '1')
  writeSetting(db, 'cloudSavedPassword', `ENC:${Buffer.from(password, 'utf8').toString('base64')}`)
}

beforeEach(() => {
  cryptoCtl.failDecrypt = false
  logCalls.length = 0
})

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close()
})

describe('启动门控 prepareBoot：每次打开都要重新登录', () => {
  it('未开启自动登录 → 未登录，且本机会话被清掉（不能凭旧会话直接进软件）', async () => {
    const { svc, storage, db } = newService(fakeAuth({ hasLiveSession: true }))
    // 先让凭据文件里真的有东西：清没清得掉要看这个
    storage!.setItem('workbuddy-cloud.session.pk', JSON.stringify(SESSION))
    await storage!.flush()

    const s = await svc.prepareBoot()

    expect(s.signedIn).toBe(false)
    expect(local(db, 'cloudAutoLogin')).toBe('0')
    // 本机会话必须真的没了，否则下次打开又能直接进
    expect(storage!.keys()).toHaveLength(0)
    await storage!.flush()
    expect(existsSync((storage as unknown as { file: string }).file)).toBe(false)
  })

  it('未开启自动登录、SDK 内存里还有会话 → 仍然未登录', async () => {
    const { svc } = newService(fakeAuth({ hasLiveSession: true }))
    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(false)
    // 后续 status() 也不能把它翻回已登录
    expect((await svc.status()).signedIn).toBe(false)
  })

  it('开了自动登录但没有邮箱 → 未登录，并把开关拨回 0（不反复空转）', async () => {
    const { svc, db } = newService(fakeAuth())
    const { writeSetting } = await import('../../src/main/services/settings')
    writeSetting(db, 'cloudAutoLogin', '1')

    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(false)
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })

  it('开了自动登录但没有密码密文 → 未登录', async () => {
    const { svc, db } = newService(fakeAuth({ expectPassword: PASSWORD }))
    const { writeSetting } = await import('../../src/main/services/settings')
    writeSetting(db, 'cloudAutoLogin', '1')
    writeSetting(db, 'cloudAccountEmail', MAIL)

    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(false)
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })

  it('有邮箱 + 密码密文 + 网络可用 → 自动登录成功，直接已登录', async () => {
    const { svc, db } = newService(fakeAuth({ expectPassword: PASSWORD }))
    await seedAutoLogin(db)

    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(true)
    expect(s.email).toBe(MAIL)
    expect(local(db, 'cloudAutoLogin')).toBe('1')
  })

  it('自动登录时断网 → 未登录，并把「是网络问题」说清楚', async () => {
    const { svc, db } = newService(fakeAuth({ netDown: true }))
    await seedAutoLogin(db)

    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(false)
    expect(s.message).toContain('网络不可用')
    expect(s.message).toContain('自动登录')
  })

  it('自动登录时密码不对（用户在别处改过）→ 未登录，提示重新输入密码', async () => {
    const { svc, db } = newService(fakeAuth({ expectPassword: 'NewPass123' }))
    await seedAutoLogin(db, PASSWORD)

    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(false)
    expect(s.message).toContain('自动登录失败')
    expect(s.message).toContain('请重新输入密码')
  })

  it('密文解不开（换电脑 / 换系统）→ 未登录，且清掉密文与开关，不留死循环', async () => {
    const { svc, db } = newService(fakeAuth({ expectPassword: PASSWORD }))
    await seedAutoLogin(db)
    cryptoCtl.failDecrypt = true

    const s = await svc.prepareBoot()
    expect(s.signedIn).toBe(false)
    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudSavePassword')).toBe('0')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })
})

describe('保存密码：只存密文，且能原样取回来', () => {
  it('勾选保存密码 → 落盘的是密文（不是明文），开关为 1', async () => {
    const { svc, db } = newService(fakeAuth())
    const r = await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: true,
      savePassword: true
    })

    expect(r.ok).toBe(true)
    const cipher = local(db, 'cloudSavedPassword')
    expect(cipher).not.toBe('')
    expect(cipher).not.toBe(PASSWORD)
    expect(cipher.startsWith('ENC:')).toBe(true)
    expect(local(db, 'cloudSavePassword')).toBe('1')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })

  it('存进去的密文能解出原密码（往返一致）', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({ email: MAIL, password: PASSWORD, remember: true, savePassword: true })

    const cipher = local(db, 'cloudSavedPassword')
    expect(Buffer.from(cipher.slice(4), 'base64').toString('utf8')).toBe(PASSWORD)
    expect(await svc.takeSavedPassword()).toBe(PASSWORD)
  })

  it('没勾保存密码 → 不落任何密文', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({ email: MAIL, password: PASSWORD, remember: true, savePassword: false })

    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudSavePassword')).toBe('0')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })

  it('勾了自动登录但没勾保存密码 → 自动登录隐含保存密码，密文照样存', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: true,
      savePassword: false,
      autoLogin: true
    })

    expect(local(db, 'cloudSavedPassword')).not.toBe('')
    expect(local(db, 'cloudSavePassword')).toBe('1')
    expect(local(db, 'cloudAutoLogin')).toBe('1')
  })

  it('没勾记住邮箱 → 邮箱与密码一起清掉（没有账号标识就无法自动登录）', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: false,
      savePassword: true
    })

    expect(local(db, 'cloudAccountEmail')).toBe('')
    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })

  it('取消勾选（forgetSavedPassword）→ 立刻删掉密文并关掉自动登录', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: true,
      savePassword: true,
      autoLogin: true
    })
    expect(local(db, 'cloudSavedPassword')).not.toBe('')

    const r = svc.forgetSavedPassword()
    expect(r.ok).toBe(true)
    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudSavePassword')).toBe('0')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
    expect(await svc.takeSavedPassword()).toBe('')
  })

  it('自动登录开着时不把密码明文交给界面（那趟登录由主进程自己完成）', async () => {
    const { svc, db } = newService(fakeAuth())
    await seedAutoLogin(db)
    expect(await svc.takeSavedPassword()).toBe('')
  })

  it('注册不替用户打开保存密码 / 自动登录', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signUp({
      nickname: '老王',
      email: MAIL,
      password: PASSWORD,
      code: '123456',
      verificationId: 'v-1'
    })
    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
  })
})

describe('退出登录 / 修改密码后的一致性', () => {
  it('退出登录 → 清掉保存的密码并关掉自动登录（否则等于退不掉）', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: true,
      savePassword: true,
      autoLogin: true
    })
    expect(local(db, 'cloudSavedPassword')).not.toBe('')

    const r = await svc.signOut()
    expect(r.ok).toBe(true)
    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudSavePassword')).toBe('0')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
    expect((await svc.status()).signedIn).toBe(false)
  })

  it('修改密码成功 → 旧密码作废，本机保存的密码一并清掉', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: true,
      savePassword: true,
      autoLogin: true
    })

    const r = await svc.changePassword({ oldPassword: PASSWORD, newPassword: 'An0ther!Pass' })
    expect(r.ok).toBe(true)
    expect(local(db, 'cloudSavedPassword')).toBe('')
    expect(local(db, 'cloudAutoLogin')).toBe('0')
    expect(r.message).toContain('已清除本机保存的密码')
  })
})

describe('安全底线：密码绝不明文落盘、绝不进日志', () => {
  it('整条登录 + 自动登录链路里，日志中不出现密码', async () => {
    const { svc, db } = newService(fakeAuth({ expectPassword: PASSWORD }))
    await svc.signIn({
      email: MAIL,
      password: PASSWORD,
      remember: true,
      savePassword: true,
      autoLogin: true
    })
    await seedAutoLogin(db)
    await svc.prepareBoot()

    const all = logCalls.map((a) => a.join(' ')).join('\n')
    expect(all).not.toContain(PASSWORD)
    // 密文同样不该进日志（它是可在本机还原的凭据）
    expect(all).not.toContain(local(db, 'cloudSavedPassword'))
  })

  it('落盘的密文里不含密码明文', async () => {
    const { svc, db } = newService(fakeAuth())
    await svc.signIn({ email: MAIL, password: PASSWORD, remember: true, savePassword: true })
    expect(local(db, 'cloudSavedPassword')).not.toContain(PASSWORD)
  })
})
