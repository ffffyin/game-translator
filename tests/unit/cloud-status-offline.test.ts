import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'

// CloudService 构造时不需要 electron，但模块顶层 import 了 app —— 在 node 环境下
// 这个包只导出一个二进制路径字符串，取 .on 会炸，所以这里直接替掉。
vi.mock('electron', () => ({ app: { on: (): void => undefined } }))

import { CloudService } from '../../src/main/services/cloud'
import { SecureAuthStorage } from '../../src/main/services/cloud-storage'
import type { CloudStatus } from '../../src/shared/cloud'

// ---------------------------------------------------------------------------
// 登录策略（2026-10-09 起）：
//   **每次启动都需要重新登录；离线打不开软件。**
//
// status() 是「能不能用软件」的唯一开关。它只有在「本次进程内成功在线登录过」
// （onlineLoginOk）时才可能给出 signedIn=true —— 本机会话文件、SDK 内存会话、
// 上一次的缓存一律不算凭据。唯一的例外是已经在线登录后中途掉线（人刚验过身份）。
//
// 这里不连真网络，直接注入假的 auth 客户端（以及可选的本地凭据存储），
// 覆盖 SDK 的三种离线表现 + 「本地还留着会话」这个最容易漏回去的分支。
// ---------------------------------------------------------------------------

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
  onlineLoginOk: boolean
}

function serviceWith(
  auth: Record<string, unknown>,
  cached: CloudStatus | null,
  storage: SecureAuthStorage | null = null,
  onlineLoginOk = false
): CloudService {
  // root / getDb 都给空实现：这几条路径不会碰数据库（读昵称失败也会被兜住）
  const svc = new CloudService('', () => undefined as never)
  const m = svc as unknown as Mutable
  m.client = { auth, database: {} }
  m.cached = cached
  m.initError = null
  m.storage = storage
  m.onlineLoginOk = onlineLoginOk
  return svc
}

/** 造一个装着 SDK 同款会话 blob 的本地凭据存储（模拟「上次登录留下的凭据」） */
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

/** SDK 内存里还留着一份会话（storage 被 wipe 后它不一定同步清掉） */
const LIVE_SESSION = {
  getSession: async () => ({
    data: {
      accessToken: 'at',
      refreshToken: 'wbrt_1',
      expiresAt: Date.now() + 3600_000,
      user: { id: 'u-1', email: 'probe@qq.com', isAnonymous: false }
    },
    error: null
  }),
  getUser: async () => ({ data: { id: 'u-1', email: 'probe@qq.com' }, error: null })
}

const NULL_SESSION = {
  getSession: async () => ({ data: null, error: null }),
  getUser: async () => ({ data: null, error: null })
}

const NETWORK_THROW = {
  getSession: async () => {
    throw { kind: 'network', message: 'fetch failed', status: 0 }
  },
  getUser: async () => ({ data: null, error: null })
}

describe('断网 = 打不开软件', () => {
  it('断网 + 本次没在线登录过 → 未登录（缓存里写着已登录也不行）', async () => {
    const svc = serviceWith(NETWORK_THROW, SIGNED_IN)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
    expect(s.online).toBe(false)
    expect(s.message).toContain('联网')
  })

  it('getSession 返回 null（SDK 续期失败）+ 没在线登录过 → 未登录', async () => {
    const svc = serviceWith(NULL_SESSION, SIGNED_IN)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })

  it('本机会话文件还在 + 没在线登录过 → 未登录（离线兜底已废，不许再放行）', async () => {
    const storage = storageWithSession(Date.now() + 3600_000)
    const svc = serviceWith(NETWORK_THROW, null, storage)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
    expect(s.online).toBe(false)
  })

  it('SDK 内存里还有会话 + 没在线登录过 → 未登录（每次启动都要重新登录）', async () => {
    const svc = serviceWith(LIVE_SESSION, null)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
    expect(s.message).not.toBe('已登录')
  })

  it('确实没缓存过登录态、本机也没凭据时返回未登录，而不是凭空造一个已登录', async () => {
    const svc = serviceWith(NULL_SESSION, null)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })
})

describe('在线登录成功后掉线：不放人出去，也不把人锁在门外', () => {
  it('SDK 续期失败会给 {data:null,error:null}：刚登录成功过的人仍算已登录', async () => {
    const svc = serviceWith(NULL_SESSION, SIGNED_IN, null, true)
    const s = await svc.status()
    expect(s.signedIn).toBe(true)
    expect(s.userId).toBe('u-1')
    expect(s.accountName).toBe('老王')
    // 但仍然要如实告诉界面：这一刻连不上云端
    expect(s.online).toBe(false)
    expect(s.message).toContain('网络不可用')
  })

  it('getSession 抛网络错误时同样回落缓存，不把已登录踢下线', async () => {
    const svc = serviceWith(NETWORK_THROW, SIGNED_IN, null, true)
    const s = await svc.status()
    expect(s.signedIn).toBe(true)
    expect(s.online).toBe(false)
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

  it('凭据已 wipe（主动退出过）→ 锁死，不能把旧凭据翻出来', async () => {
    const storage = storageWithSession(Date.now() + 3600_000)
    await storage.wipe()
    const svc = serviceWith(NULL_SESSION, null, storage)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })
})
