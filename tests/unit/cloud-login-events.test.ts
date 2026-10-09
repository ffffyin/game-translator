// 锁死两件事：
//  1. 登录/注册/启动会往云端 login_events 插一条流水（作者要靠它数「注册用户数 / 今日登录数」，
//     云端除了这张表没有任何别的数据源）；
//  2. 这玩意儿是**纯统计**，绝不能反过来拖垮登录 —— 插入被 RLS 拒、甚至网络直接炸，
//     signIn 都必须照常返回 ok:true。
//
// 所以下面最关键的一条用例是「埋点失败但登录成功」。埋点代码里所有异常都在
// recordEvent 内部吞掉，这里把它钉住：谁要是哪天让 insert 的异常冒出去，
// 一次 RLS 策略抖动就会变成「全网用户登不进软件」。
import { describe, it, expect, vi, afterEach } from 'vitest'

// CloudService 构造时不需要 electron，但模块顶层 import 了 app —— node 环境下
// 这个包只导出一个二进制路径字符串，取 .on 会炸，所以这里直接替掉。
vi.mock('electron', () => ({ app: { on: (): void => undefined } }))

import { CloudService } from '../../src/main/services/cloud'
import { APP_VERSION } from '../../src/shared/version'
import type { CloudStatus } from '../../src/shared/cloud'

const ENDPOINT = 'https://game-translator.app.workbuddy.host'
const LOGIN_EVENTS_URL = `${ENDPOINT}/.cloud/database/rest/login_events`

type Captured = { url: string; method: string; body: unknown }

/** 一次 fetch 的返回：可以直接给 Response，也可以 throw 来模拟网络异常 */
type Responder = (url: string, body: unknown) => Response | Promise<Response>

// ---------------------------------------------------------------------------
// 假的云端：不连真网络，把 SDK 的 database 换成会往全局 fetch 发一条 PostgREST
// 风格请求的替身，这样既能断言「插了什么」，也能断言「请求体里没什么」。
// ---------------------------------------------------------------------------

async function emitInsert(
  table: string,
  rows: Record<string, unknown>
): Promise<{ data: unknown; error: unknown }> {
  const res = await fetch(`${ENDPOINT}/.cloud/database/rest/${table}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(rows)
  })
  if (!res.ok) {
    let payload: Record<string, unknown> = {}
    try {
      payload = (await res.json()) as Record<string, unknown>
    } catch {
      payload = {}
    }
    return {
      data: null,
      error: {
        kind: res.status === 403 ? 'permission-denied' : 'unknown',
        status: res.status,
        code: typeof payload.code === 'string' ? payload.code : '',
        message: typeof payload.message === 'string' ? payload.message : `HTTP ${res.status}`
      }
    }
  }
  return { data: null, error: null }
}

/** 可链式调用的假 query：select/eq/maybeSingle 原样透传，insert 走一次 HTTP */
function fakeDatabase(): { from(table: string): Record<string, unknown> } {
  return {
    from(table: string): Record<string, unknown> {
      let result: Promise<{ data: unknown; error: unknown }> = Promise.resolve({
        data: null,
        error: null
      })
      const q: Record<string, unknown> = {}
      q.select = (): Record<string, unknown> => q
      q.eq = (): Record<string, unknown> => q
      q.maybeSingle = (): Record<string, unknown> => q
      q.insert = (rows: Record<string, unknown>): Record<string, unknown> => {
        result = emitInsert(table, rows)
        return q
      }
      q.then = (
        onFulfilled?: ((v: unknown) => unknown) | null,
        onRejected?: ((e: unknown) => unknown) | null
      ): Promise<unknown> => result.then(onFulfilled, onRejected)
      return q
    }
  }
}

const SESSION = {
  accessToken: 'at',
  refreshToken: 'wbrt_1',
  expiresAt: Date.now() + 3600_000,
  user: { id: 'u-1', email: 'probe@qq.com', isAnonymous: false }
}

function fakeAuth(session: typeof SESSION | null): Record<string, unknown> {
  return {
    signInWithPassword: async () => ({ data: { session }, error: null }),
    verifyOtp: async () => ({ data: { session }, error: null }),
    getSession: async () => (session ? { data: session, error: null } : { data: null, error: null }),
    getUser: async () => ({ data: session?.user ?? null, error: null })
  }
}

type Mutable = {
  client: unknown
  cached: CloudStatus | null
  initError: string | null
  storage: unknown
  /** 「本次进程内是否成功在线登录过」：现在它是能不能用软件的唯一凭据 */
  onlineLoginOk: boolean
}

/**
 * 造一个 CloudService 壳：root / getDb 给空实现（这几条路径不碰数据库，
 * 读写昵称失败也会被兜住），再把 client 换成假的。
 */
function serviceWith(session: typeof SESSION | null = SESSION): CloudService {
  const svc = new CloudService('', () => undefined as never)
  const m = svc as unknown as Mutable
  m.client = { auth: fakeAuth(session), database: fakeDatabase() }
  m.cached = null
  m.initError = null
  m.storage = null
  return svc
}

function installFetch(responder: Responder): Captured[] {
  const calls: Captured[] = []
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const raw = typeof init?.body === 'string' ? init.body : ''
    let body: unknown = null
    if (raw) {
      try {
        body = JSON.parse(raw)
      } catch {
        body = raw
      }
    }
    calls.push({ url: String(input), method: init?.method ?? '', body })
    return responder(String(input), body)
  })
  vi.stubGlobal('fetch', spy)
  return calls
}

/** 埋点是 fire-and-forget（void），断言前让微任务队列跑干净 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** 只看发给 login_events 的 INSERT，按 kind 过滤（登录会同时产生 login + boot 两条） */
function eventsOfKind(calls: Captured[], kind: string): Record<string, unknown>[] {
  return calls
    .filter((c) => c.url === LOGIN_EVENTS_URL)
    .map((c) => c.body as Record<string, unknown>)
    .filter((b) => b && b.kind === kind)
}

describe('登录流水埋点（纯统计，不许影响登录）', () => {
  it('登录成功 → 往 login_events 插一条 kind=login，带 app_version', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    const svc = serviceWith()

    const r = await svc.signIn({ email: 'probe@qq.com', password: 'abcd1234', remember: true })
    expect(r.ok).toBe(true)
    await flush()

    const logins = eventsOfKind(calls, 'login')
    expect(logins).toHaveLength(1)
    expect(logins[0].app_version).toBe(APP_VERSION)
    expect(calls[0].method).toBe('POST')
  })

  it('注册成功 → 插的是 kind=register', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    const svc = serviceWith()

    const r = await svc.signUp({
      nickname: '老王',
      email: 'probe@qq.com',
      password: 'abcd1234',
      code: '123456',
      verificationId: 'v-1'
    })
    expect(r.ok).toBe(true)
    await flush()

    expect(eventsOfKind(calls, 'register')).toHaveLength(1)
    expect(eventsOfKind(calls, 'login')).toHaveLength(0)
  })

  it('请求体里绝不能带 owner_id —— 传了会被 RLS 的 WITH CHECK 拒', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    const svc = serviceWith()

    await svc.signIn({ email: 'probe@qq.com', password: 'abcd1234', remember: true })
    await flush()

    const rows = calls
      .filter((c) => c.url === LOGIN_EVENTS_URL)
      .map((c) => c.body as Record<string, unknown>)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(Object.keys(row)).not.toContain('owner_id')
      expect(JSON.stringify(row)).not.toContain('owner_id')
    }
    // owner_id 由服务端 DEFAULT auth.uid() 填，客户端只负责 kind 与版本
    expect(Object.keys(rows[0]).sort()).toEqual(['app_version', 'kind'])
  })

  it('插入被 RLS 拒（403 / 42501）时 signIn 仍然返回 ok:true', async () => {
    const calls = installFetch(
      () =>
        new Response(
          JSON.stringify({
            code: '42501',
            message: 'new row violates row-level security policy for table "login_events"'
          }),
          { status: 403 }
        )
    )
    const svc = serviceWith()

    const r = await svc.signIn({ email: 'probe@qq.com', password: 'abcd1234', remember: true })
    await flush()

    // 埋点确实发出去了（说明不是压根没调），但失败被吞掉
    expect(calls.filter((c) => c.url === LOGIN_EVENTS_URL).length).toBeGreaterThan(0)
    expect(r.ok).toBe(true)
    expect(r.status.signedIn).toBe(true)
  })

  it('网络直接炸（fetch 抛异常）时 signIn 仍然返回 ok:true', async () => {
    const calls = installFetch(() => {
      throw new TypeError('fetch failed')
    })
    const svc = serviceWith()

    const r = await svc.signIn({ email: 'probe@qq.com', password: 'abcd1234', remember: true })
    await flush()

    expect(calls.filter((c) => c.url === LOGIN_EVENTS_URL).length).toBeGreaterThan(0)
    expect(r.ok).toBe(true)
    expect(r.status.signedIn).toBe(true)
  })

  it('登录失败时不插 login 流水（只有成功才统计）', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    // 未登录的壳：这样 status() 也不会顺带发 boot，calls 里出现任何一条都是问题
    const svc = serviceWith(null)
    // 密码为空在校验阶段就被挡下，根本走不到埋点
    const r = await svc.signIn({ email: 'probe@qq.com', password: '', remember: true })
    await flush()

    expect(r.ok).toBe(false)
    expect(eventsOfKind(calls, 'login')).toHaveLength(0)
    expect(calls.filter((c) => c.url === LOGIN_EVENTS_URL)).toHaveLength(0)
  })
})

describe('boot 流水：一个进程只发一次', () => {
  it('同一个实例反复 status()，只插一条 boot', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    const svc = serviceWith()
    // 现在的判定：只有本次进程内成功在线登录过才算已登录，boot 才发得出去
    ;(svc as unknown as Mutable).onlineLoginOk = true

    await svc.status()
    await svc.status()
    await svc.status()
    await flush()

    // status() 会被界面反复轮询，每刷一次插一行会把「今日登录数」冲成虚高
    expect(eventsOfKind(calls, 'boot')).toHaveLength(1)
  })

  it('在线登录成功后中途掉线：仍算已登录，同样只发一次 boot（公共出口覆盖所有分支）', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    const svc = new CloudService('', () => undefined as never)
    const m = svc as unknown as Mutable
    m.client = {
      auth: {
        // SDK 续期失败的表现：不报错，直接给 null 会话
        getSession: async () => {
          throw { kind: 'network', message: 'fetch failed', status: 0 }
        },
        getUser: async () => ({ data: null, error: null })
      },
      database: fakeDatabase()
    }
    m.cached = {
      available: true,
      signedIn: true,
      userId: 'u-1',
      email: 'probe@qq.com',
      phone: null,
      accountName: '老王',
      remoteUpdatedAt: null,
      remoteSummary: null,
      online: true,
      message: '已登录'
    }
    m.initError = null
    m.storage = null
    // 人刚在线登录成功过，之后才掉线 —— 这种情况必须放行，且 boot 只发一次
    m.onlineLoginOk = true

    const first = await svc.status()
    const second = await svc.status()
    await flush()

    expect(first.signedIn).toBe(true)
    expect(second.online).toBe(false)
    expect(eventsOfKind(calls, 'boot')).toHaveLength(1)
  })

  it('未登录时不发任何流水', async () => {
    const calls = installFetch(() => new Response('{}', { status: 201 }))
    const svc = serviceWith(null)

    const s = await svc.status()
    await flush()

    expect(s.signedIn).toBe(false)
    expect(calls.filter((c) => c.url === LOGIN_EVENTS_URL)).toHaveLength(0)
  })
})
