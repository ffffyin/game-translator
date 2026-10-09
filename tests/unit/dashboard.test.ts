// 本地运营数据看板（scripts/dashboard.mjs）的单元测试。
//
// 这里锁死三条实测出来的硬约束（别删，都是踩过的坑）：
//   1. 发往云端的请求绝不能带 origin / referer —— 云端有来源白名单，
//      带 Origin 且不是应用自己域名时会 403 access_denied，不带反而 200；
//   2. 鉴权头名是 x-wb-webapp-access-key，不是 apikey；
//   3. 取数失败回给页面的 502 里绝不能出现 publishable key。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// 测试里会用 vi.stubGlobal('fetch') 顶掉全局 fetch，所以先把真身抓在手里，
// 后面访问本地看板服务还得靠它。
const realFetch = globalThis.fetch.bind(globalThis)

import {
  fetchAppStats,
  createDashboardServer,
  listenWithFallback,
  renderDashboardHtml,
  resolvePort,
  CLOUD_PUBLISHABLE_KEY,
  STATS_RPC_URL,
  DEFAULT_PORT
} from '../../scripts/dashboard.mjs'

type Handle = {
  server: Server
  port: number
  host: string
  url: string
  close: () => Promise<void>
}

type Captured = { url: string; headers: Record<string, string>; init: RequestInit }

/** 一份和线上结构一致的样例数据。 */
const SAMPLE = {
  updatedAt: '2026-10-09T17:41:57.915+08:00',
  registeredUsers: 2,
  registeredAt: '2026-10-09T10:00:00.000+08:00',
  todayUsers: 1,
  todayLogins: 1,
  todayBoots: 2,
  active7d: 1,
  active30d: 1,
  syncedUsers: 1,
  versions: [{ version: '1.0.0', users: 1 }],
  trend: [
    { day: '2026-09-26', users: 0, logins: 0 },
    { day: '2026-10-09', users: 1, logins: 3 }
  ]
}

/** 本文件里启动过的服务，统一在 afterEach 里关掉，避免端口泄漏拖慢全量测试。 */
const openHandles: Handle[] = []
const openServers: Server[] = []

/**
 * 造一个假的 fetch，同时把每次调用的请求头记下来。
 * @param impl 返回 Response 的实现
 * @returns 假的 fetch 与调用记录
 */
function captureFetch(impl: (input: unknown, init?: RequestInit) => Promise<Response> | Response) {
  const calls: Captured[] = []
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers((init?.headers ?? {}) as HeadersInit).forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
    calls.push({ url: String(input), headers, init: init ?? {} })
    return await impl(input, init)
  })
  return { calls, spy }
}

/**
 * 造一个 JSON 响应。
 * @param payload 任意可序列化内容
 * @param status HTTP 状态码
 * @returns Response
 */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * 起一个看板服务（系统分配端口），并登记待关闭。
 * @param options 传给 createDashboardServer 的参数
 * @returns 服务句柄
 */
async function startBoard(options: Record<string, unknown> = {}): Promise<Handle> {
  const handle = (await createDashboardServer({ port: 0, ...options })) as Handle
  openHandles.push(handle)
  return handle
}

/**
 * 拉本地服务的某个接口。
 * @param handle 服务句柄
 * @param path 路径（如 'api/stats'）
 * @returns Response
 */
function get(handle: Handle, path: string): Promise<Response> {
  return realFetch(handle.url + path)
}

afterEach(async () => {
  vi.unstubAllGlobals()
  while (openHandles.length > 0) {
    const handle = openHandles.pop()
    if (handle) await handle.close()
  }
  while (openServers.length > 0) {
    const server = openServers.pop()
    if (server && server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
})

describe('fetchAppStats（云端取数）', () => {
  it('POST 到 app_stats，带 x-wb-webapp-access-key，且不带 origin / referer', async () => {
    const { calls, spy } = captureFetch(() => jsonResponse(SAMPLE))
    const data = await fetchAppStats({ fetchImpl: spy as unknown as typeof fetch })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(STATS_RPC_URL)
    expect((calls[0].init as RequestInit).method).toBe('POST')
    expect(calls[0].headers['x-wb-webapp-access-key']).toBe(CLOUD_PUBLISHABLE_KEY)
    // 这条最关键：设了 Origin 反而被云端 403 拒掉
    expect(calls[0].headers['origin']).toBeUndefined()
    expect(calls[0].headers['referer']).toBeUndefined()
    const lowerKeys = Object.keys(calls[0].headers).map((k) => k.toLowerCase())
    expect(lowerKeys).not.toContain('origin')
    expect(lowerKeys).not.toContain('referer')
    expect(data.registeredUsers).toBe(2)
  })

  it('非 2xx 抛错，且错误信息里不含 publishable key', async () => {
    const { spy } = captureFetch(() =>
      jsonResponse({ message: 'the request origin is not allowed for this client' }, 403)
    )
    await expect(fetchAppStats({ fetchImpl: spy as unknown as typeof fetch })).rejects.toThrow(/403/)
  })

  it('超时抛中文超时错误', async () => {
    const { spy } = captureFetch((_input, init) => {
      const signal = (init as RequestInit)?.signal as AbortSignal | undefined
      return new Promise<Response>((_resolve, reject) => {
        if (!signal) {
          reject(new Error('测试桩没收到 signal'))
          return
        }
        signal.addEventListener('abort', () => {
          const err = new Error('The operation was aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    await expect(
      fetchAppStats({ fetchImpl: spy as unknown as typeof fetch, timeoutMs: 40 })
    ).rejects.toThrow(/超时/)
  })

  it('非 JSON 内容抛错', async () => {
    const { spy } = captureFetch(
      () => new Response('<html>502 bad gateway</html>', { status: 200 })
    )
    await expect(
      fetchAppStats({ fetchImpl: spy as unknown as typeof fetch })
    ).rejects.toThrow(/JSON/)
  })

  it('网络异常抛错且不泄漏密钥', async () => {
    const { spy } = captureFetch(() => {
      throw new Error('connect ECONNREFUSED ' + CLOUD_PUBLISHABLE_KEY)
    })
    let message = ''
    try {
      await fetchAppStats({ fetchImpl: spy as unknown as typeof fetch })
    } catch (err) {
      message = String((err as Error).message)
    }
    expect(message).toContain('无法连接')
    expect(message).not.toContain(CLOUD_PUBLISHABLE_KEY)
  })
})

describe('GET /api/stats（本地代理）', () => {
  it('正常时把远端 JSON 原样返回', async () => {
    const { spy } = captureFetch(() => jsonResponse(SAMPLE))
    const handle = await startBoard({ fetchImpl: spy as unknown as typeof fetch })

    const res = await get(handle, 'api/stats')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    await expect(res.json()).resolves.toEqual(SAMPLE)
  })

  it('远端 403 → 本地 502，且不把 publishable key 回给页面', async () => {
    const { spy } = captureFetch(() =>
      jsonResponse({ message: 'the request origin is not allowed for this client' }, 403)
    )
    const handle = await startBoard({ fetchImpl: spy as unknown as typeof fetch })

    const res = await get(handle, 'api/stats')
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(CLOUD_PUBLISHABLE_KEY)
    expect(JSON.parse(text).error).toContain('403')
  })

  it('远端超时 → 本地 502 且提示超时', async () => {
    const { spy } = captureFetch((_input, init) => {
      const signal = (init as RequestInit)?.signal as AbortSignal | undefined
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    const handle = await startBoard({
      fetchImpl: spy as unknown as typeof fetch,
      timeoutMs: 40
    })

    const res = await get(handle, 'api/stats')
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(CLOUD_PUBLISHABLE_KEY)
    expect(JSON.parse(text).error).toContain('超时')
  })

  it('远端返回非 JSON → 本地 502', async () => {
    const { spy } = captureFetch(() => new Response('not json at all', { status: 200 }))
    const handle = await startBoard({ fetchImpl: spy as unknown as typeof fetch })

    const res = await get(handle, 'api/stats')
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).not.toContain(CLOUD_PUBLISHABLE_KEY)
    expect(JSON.parse(text).error).toContain('JSON')
  })

  it('页面拿到的响应里不会冒出任何 origin 相关头', async () => {
    const { spy } = captureFetch(() => jsonResponse(SAMPLE))
    const handle = await startBoard({ fetchImpl: spy as unknown as typeof fetch })
    const res = await get(handle, 'api/stats')
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})

describe('看板页面', () => {
  it('首页返回内联 HTML，不引任何 CDN，也不含密钥', async () => {
    const handle = await startBoard()
    const res = await realFetch(handle.url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')

    const html = await res.text()
    expect(html).toContain('游戏翻译助手')
    expect(html).toContain('/api/stats')
    expect(html).not.toContain(CLOUD_PUBLISHABLE_KEY)
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/)
  })

  it('renderDashboardHtml 自带自动刷新与错误重试入口', () => {
    const html = renderDashboardHtml()
    expect(html).toContain('refresh')
    expect(html).toContain('retry')
    expect(html).toContain('60000')
    expect(html).toContain('#161A21')
    expect(html).toContain('#F2B24C')
    expect(html).toContain('#3CC7AB')
  })

  it('未知路径返回 404', async () => {
    const handle = await startBoard()
    const res = await get(handle, 'api/nope')
    expect(res.status).toBe(404)
  })
})

describe('端口解析与占用回退', () => {
  it('--port 与 PORT 环境变量都能覆盖默认端口', () => {
    expect(resolvePort(['--port', '9000'], {})).toBe(9000)
    expect(resolvePort(['--port=9100'], {})).toBe(9100)
    expect(resolvePort([], { PORT: '9200' })).toBe(9200)
    expect(resolvePort([], {})).toBe(DEFAULT_PORT)
    expect(resolvePort(['--port', 'not-a-number'], {})).toBe(DEFAULT_PORT)
  })

  it('端口被占用时能换到下一个端口', async () => {
    const blocker = createServer((_req, res) => res.end('busy'))
    openServers.push(blocker)
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', () => resolve()))
    const busyPort = (blocker.address() as AddressInfo).port

    const handle = await startBoard({ port: busyPort })
    expect(handle.port).toBeGreaterThan(busyPort)
    expect(handle.port).toBeLessThanOrEqual(busyPort + 5)

    const res = await get(handle, 'api/stats')
    expect(res.status).toBeGreaterThanOrEqual(200)
  })

  it('listenWithFallback 返回实际监听端口', async () => {
    const server = createServer((_req, res) => res.end('ok'))
    openServers.push(server)
    const port = await listenWithFallback(server, { host: '127.0.0.1', port: 0 })
    expect(port).toBeGreaterThan(0)
    expect((server.address() as AddressInfo).port).toBe(port)
  })
})
