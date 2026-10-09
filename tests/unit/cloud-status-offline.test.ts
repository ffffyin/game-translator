import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

// CloudService 构造时不需要 electron，但模块顶层 import 了 app —— 在 node 环境下
// 这个包只导出一个二进制路径字符串，取 .on 会炸，所以这里直接替掉。
vi.mock('electron', () => ({ app: { on: (): void => undefined } }))

import { CloudService } from '../../src/main/services/cloud'
import { SecureAuthStorage } from '../../src/main/services/cloud-storage'
import type { CloudStatus } from '../../src/shared/cloud'

// 登录变强制之后，status() 就是「能不能用软件」的开关：
// 断网时它必须仍然返回已登录，否则一次网络抖动等于把用户锁在门外。
// 这里不连真网络，直接注入假的 auth 客户端（以及可选的本地凭据存储），
// 覆盖 SDK 的三种离线表现。

const PUBLISHABLE_KEY = 'wbpk_j7gSzC4Hd9cFphl7a2wJmo_wLuzfc9Zh2tvfBUXpw1FiIEZJQe6OUfO'
// 实测得到（用真实 SDK + 自定义 storage 跑过一次 getSession 验证）：
// SDK 把会话存在 `workbuddy-cloud.session.<publishableKey>` 这条键下。
const SESSION_KEY = `workbuddy-cloud.session.${PUBLISHABLE_KEY}`

const SIGNED_IN: CloudStatus = {
  available: true,
  signedIn: true,
  userId: 'u-1',
  email: 'a***@qq.com',
  phone: null,
  accountName: '老王',
  remoteUpdatedAt: null,
  remoteSummary: null,
  online: true,
  message: '已登录'
}

type Mutable = {
  client: unknown
  cached: CloudStatus | null
  initError: string | null
  storage: SecureAuthStorage | null
}

function serviceWith(
  auth: Record<string, unknown>,
  cached: CloudStatus | null,
  storage: SecureAuthStorage | null = null
): CloudService {
  // root / getDb 都给空实现：这几条路径不会碰数据库（读昵称失败也会被兜住）
  const svc = new CloudService('', () => undefined as never)
  const m = svc as unknown as Mutable
  m.client = { auth, database: {} }
  m.cached = cached
  m.initError = null
  m.storage = storage
  return svc
}

/** 造一个装着 SDK 同款会话 blob 的本地凭据存储 */
function storageWithSession(expiresAt: number): SecureAuthStorage {
  const file = join(tmpdir(), `gt-probe-${Date.now()}-${Math.random()}.enc`)
  const s = new SecureAuthStorage(file)
  s.setItem(
    SESSION_KEY,
    JSON.stringify({
      accessToken: 'at',
      refreshToken: 'wbrt_1',
      expiresAt,
      user: { id: 'u-1', email: 'probe@qq.com', isAnonymous: false }
    })
  )
  return s
}

const NULL_SESSION = {
  getSession: async () => ({ data: null, error: null }),
  getUser: async () => ({ data: null, error: null })
}

describe('断网时的登录态', () => {
  it('SDK 续期失败会返回 {data:null,error:null}：已登录用户不能被判成未登录', async () => {
    const svc = serviceWith(NULL_SESSION, SIGNED_IN)
    const s = await svc.status()
    expect(s.signedIn).toBe(true)
    expect(s.userId).toBe('u-1')
    expect(s.accountName).toBe('老王')
    // 但仍然要如实告诉界面：这一刻连不上云端
    expect(s.online).toBe(false)
    expect(s.message).toContain('网络不可用')
  })

  it('getSession 抛网络错误时同样回落缓存，不把已登录踢下线', async () => {
    const svc = serviceWith(
      {
        getSession: async () => {
          throw { kind: 'network', message: 'fetch failed', status: 0 }
        },
        getUser: async () => ({ data: null, error: null })
      },
      SIGNED_IN
    )
    const s = await svc.status()
    expect(s.signedIn).toBe(true)
    expect(s.online).toBe(false)
  })

  it('确实没缓存过登录态、本机也没凭据时返回未登录，而不是凭空造一个已登录', async () => {
    const svc = serviceWith(NULL_SESSION, null)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
    expect(s.message).toBe('未登录')
  })
})

describe('冷启动即断网：本机凭据兜底', () => {
  it('凭据未过期 → 仍算已登录，online 为 false', async () => {
    const storage = storageWithSession(Date.now() + 3600_000)
    const svc = serviceWith(NULL_SESSION, null, storage)
    const s = await svc.status()
    expect(s.signedIn).toBe(true)
    expect(s.online).toBe(false)
    expect(s.userId).toBe('u-1')
    expect(s.email).toBe('probe@qq.com')
    expect(s.message).toContain('离线')
  })

  it('兜底结果写回内存缓存，后续刷新不必再解析凭据文件', async () => {
    const storage = storageWithSession(Date.now() + 3600_000)
    const svc = serviceWith(NULL_SESSION, null, storage)
    const first = await svc.status()
    expect(first.signedIn).toBe(true)
    // 第二次把存储抽掉：若第一次没写回缓存，这里就会掉回未登录
    ;(svc as unknown as Mutable).storage = null
    const second = await svc.status()
    expect(second.signedIn).toBe(true)
    expect(second.userId).toBe('u-1')
  })

  it('凭据已过期 → 维持未登录，不能拿过期 token 放行', async () => {
    const storage = storageWithSession(Date.now() - 1000)
    const svc = serviceWith(NULL_SESSION, null, storage)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })

  it('凭据是坏 JSON → 维持未登录，且不能抛异常', async () => {
    const file = join(tmpdir(), `gt-probe-bad-${Date.now()}.enc`)
    const storage = new SecureAuthStorage(file)
    storage.setItem(SESSION_KEY, '{not-json')
    const svc = serviceWith(NULL_SESSION, null, storage)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })

  it('主动退出登录（凭据已 wipe）→ 锁死，不能把旧凭据翻出来', async () => {
    const storage = storageWithSession(Date.now() + 3600_000)
    await storage.wipe()
    const svc = serviceWith(NULL_SESSION, null, storage)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
    expect(s.message).toBe('未登录')
  })
})

describe('主动退出后不会被缓存复活', () => {
  it('断网时缓存里的「已退出登录」不会被当成已登录', async () => {
    const svc = serviceWith(NULL_SESSION, {
      ...SIGNED_IN,
      signedIn: false,
      message: '已退出登录'
    })
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })
})
