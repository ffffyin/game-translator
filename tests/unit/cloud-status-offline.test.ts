import { describe, it, expect, vi } from 'vitest'

// CloudService 构造时不需要 electron，但模块顶层 import 了 app —— 在 node 环境下
// 这个包只导出一个二进制路径字符串，取 .on 会炸，所以这里直接替掉。
vi.mock('electron', () => ({ app: { on: (): void => undefined } }))

import { CloudService } from '../../src/main/services/cloud'
import type { CloudStatus } from '../../src/shared/cloud'

// 登录变强制之后，status() 就是「能不能用软件」的开关：
// 断网时它必须仍然返回已登录，否则一次网络抖动等于把用户锁在门外。
// 这里不连真网络，直接注入假的 auth 客户端，覆盖 SDK 的三种离线表现。

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
}

function serviceWith(auth: Record<string, unknown>, cached: CloudStatus | null): CloudService {
  // root / getDb 都给空实现：这条路径不会碰数据库
  const svc = new CloudService('', () => undefined as never)
  const m = svc as unknown as Mutable
  m.client = { auth, database: {} }
  m.cached = cached
  m.initError = null
  return svc
}

describe('断网时的登录态', () => {
  it('SDK 续期失败会返回 {data:null,error:null}：已登录用户不能被判成未登录', async () => {
    const svc = serviceWith(
      {
        getSession: async () => ({ data: null, error: null }),
        getUser: async () => ({ data: null, error: null })
      },
      SIGNED_IN
    )
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

  it('确实没缓存过登录态时返回未登录，而不是凭空造一个已登录', async () => {
    const svc = serviceWith({ getSession: async () => ({ data: null, error: null }) }, null)
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
    expect(s.message).toBe('未登录')
  })

  it('主动退出登录后，断网不会把旧的已登录缓存翻出来', async () => {
    const svc = serviceWith(
      { getSession: async () => ({ data: null, error: null }) },
      { ...SIGNED_IN, signedIn: false, message: '已退出登录' }
    )
    const s = await svc.status()
    expect(s.signedIn).toBe(false)
  })
})
