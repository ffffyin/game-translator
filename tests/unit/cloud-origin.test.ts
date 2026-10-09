// 锁死一条实测出来的硬约束：发往应用云端的所有请求都必须带应用来源。
//
// 背景（别删，这是踩过的坑）：不带 Origin 时服务端返回
//   401 invalid_grant "the session is invalid, expired or issued for another client"
// 而且 auth 与 database 两条路径都会中招。这个 401 极具误导性——用户其实存在、
// 密码也是对的，被拒的是「签发/认领令牌」这一步。拿不存在的邮箱去试探只会拿到
// 400 "Username or password incorrect."，看不出 Origin 才是变量。
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('electron', () => ({ app: { on: (): void => undefined } }))

import { fetchWithAuthOrigin } from '../../src/main/services/cloud'

const ENDPOINT = 'https://game-translator.app.workbuddy.host'

type Captured = { url: string; headers: Record<string, string> }

function stubFetch() {
  const calls: Captured[] = []
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers ?? {}).forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })
    calls.push({ url: String(input), headers })
    return new Response('{}', { status: 200 })
  })
  vi.stubGlobal('fetch', spy)
  return { calls, spy }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchWithAuthOrigin（云端请求必须带应用来源）', () => {
  it('云端 auth 请求补上 origin 与 referer', async () => {
    const { calls } = stubFetch()
    await fetchWithAuthOrigin(ENDPOINT + '/.cloud/auth/v1/signin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].headers['origin']).toBe(ENDPOINT)
    expect(calls[0].headers['referer']).toBe(ENDPOINT + '/')
  })

  it('云端 database 请求同样要补——实测缺 Origin 会被同一个 invalid_grant 拒', async () => {
    const { calls } = stubFetch()
    await fetchWithAuthOrigin(ENDPOINT + '/.cloud/database/rest/user_settings', {
      method: 'GET'
    })
    expect(calls[0].headers['origin']).toBe(ENDPOINT)
  })

  it('非本应用的请求绝不加料（不能污染模型厂商接口）', async () => {
    const { calls } = stubFetch()
    await fetchWithAuthOrigin('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: 'Bearer sk-xxx' }
    })
    expect(calls[0].headers['origin']).toBeUndefined()
    expect(calls[0].headers['referer']).toBeUndefined()
    expect(calls[0].headers['authorization']).toBe('Bearer sk-xxx')
  })

  it('不覆盖调用方已有的 origin / referer', async () => {
    const { calls } = stubFetch()
    await fetchWithAuthOrigin(ENDPOINT + '/.cloud/auth/v1/token', {
      headers: { origin: 'https://keep.me', referer: 'https://keep.me/' }
    })
    expect(calls[0].headers['origin']).toBe('https://keep.me')
    expect(calls[0].headers['referer']).toBe('https://keep.me/')
  })

  it('原有请求头与 body 不被丢掉', async () => {
    const { calls, spy } = stubFetch()
    await fetchWithAuthOrigin(ENDPOINT + '/.cloud/auth/v1/signin', {
      method: 'POST',
      headers: { 'x-wb-webapp-access-key': 'wbpk_test' },
      body: '{"username":"a"}'
    })
    expect(calls[0].headers['x-wb-webapp-access-key']).toBe('wbpk_test')
    expect((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body).toBe('{"username":"a"}')
  })

  it('支持 URL 对象与相对之外的各种入参形态，不抛错', async () => {
    const { calls } = stubFetch()
    await fetchWithAuthOrigin(new URL(ENDPOINT + '/.cloud/auth/v1/user/me'))
    expect(calls[0].headers['origin']).toBe(ENDPOINT)
  })
})
