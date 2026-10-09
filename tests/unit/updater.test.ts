// 锁死两条硬约束：
// 1. 版本号必须按语义化版本逐段比数字——字符串比较会把 1.0.10 判成比 1.0.9 旧；
// 2. 更新检查是远程外部请求，任何失败都要变成"失败结果"而不是异常，且不能污染外部站点。
import { describe, it, expect, vi, afterEach } from 'vitest'

import {
  compareVersions,
  isNewerVersion,
  parseVersion,
  formatBytes,
  type UpdateCheckResult
} from '../../src/shared/update'
import { checkForUpdate } from '../../src/main/services/updater'
import { UPDATE_MANIFEST_URL } from '../../src/shared/links'
import { APP_VERSION } from '../../src/shared/version'

type Captured = { url: string; init: RequestInit | undefined }

/** 注入可控的 fetch，并记录每次请求的 url 与 init */
function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: Captured[] = []
  const spy = vi.fn(async (input: unknown, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return impl(String(input), init)
  })
  vi.stubGlobal('fetch', spy as unknown as typeof fetch)
  return calls
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: '1.0.1',
    notes: ['修了 OCR 偶发漏字', '加了软件更新检查'],
    publishedAt: '2026-10-09',
    downloadUrl: 'https://example.com/game-translator-1.0.1-setup.exe',
    size: 138335923,
    sha256: 'a'.repeat(64),
    mandatory: false,
    ...overrides
  }
}

const MANIFEST_URL = 'https://example.com/version.json'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('版本号比较（必须逐段比数字）', () => {
  it('修订号大就是新版本', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBeGreaterThan(0)
  })

  it('同版本号相等', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })

  it('主版本大就压过次版本与修订号的累加', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
  })

  it('老版本小于新版本', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0)
  })

  // 字符串比较陷阱：'1.0.10' > '1.0.9' 用字符串比是 false，会导致用户永远收不到更新
  it('1.0.10 必须比 1.0.9 新（字符串比较的坑）', () => {
    expect('1.0.10' > '1.0.9').toBe(false)
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0)
    expect(isNewerVersion('1.0.10', '1.0.9')).toBe(true)
  })

  it('容忍前缀 v', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
  })

  it('非法版本一律返回 null，绝不假装能比', () => {
    expect(compareVersions('1.0', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.0', 'abc')).toBeNull()
    expect(compareVersions('1.0.0.1', '1.0.0')).toBeNull()
    expect(compareVersions('1.0.x', '1.0.0')).toBeNull()
    expect(compareVersions('', '1.0.0')).toBeNull()
  })

  it('isNewerVersion 在版本非法时给出保守的 false', () => {
    expect(isNewerVersion('abc', '1.0.0')).toBe(false)
    expect(isNewerVersion('1.0.1', APP_VERSION)).toBe(true)
    expect(isNewerVersion(APP_VERSION, APP_VERSION)).toBe(false)
  })

  it('parseVersion 只认三段纯数字', () => {
    expect(parseVersion('1.0.10')).toEqual({ major: 1, minor: 0, patch: 10 })
    expect(parseVersion('nope')).toBeNull()
  })
})

describe('formatBytes', () => {
  it('小于 1MB 显示 KB，大于显示 MB', () => {
    expect(formatBytes(512 * 1024)).toBe('512 KB')
    expect(formatBytes(138335923)).toBe('131.9 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.00 GB')
  })

  it('非正数或非法值返回空串（UI 据此不展示体积）', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(-1)).toBe('')
    expect(formatBytes(Number.NaN)).toBe('')
  })
})

describe('checkForUpdate：拉到清单后的三种结论', () => {
  it('远端版本更新 → available，info 字段完整', async () => {
    stubFetch(async () => jsonResponse(manifest()))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(true)
    expect(r.status).toBe('available')
    expect(r.upToDate).toBe(false)
    expect(r.info?.version).toBe('1.0.1')
    expect(r.info?.notes).toEqual(['修了 OCR 偶发漏字', '加了软件更新检查'])
    expect(r.info?.publishedAt).toBe('2026-10-09')
    expect(r.info?.downloadUrl).toBe('https://example.com/game-translator-1.0.1-setup.exe')
    expect(r.info?.size).toBe(138335923)
    expect(r.info?.sha256).toBe('a'.repeat(64))
    expect(r.info?.mandatory).toBe(false)
    expect(r.message).toContain('1.0.1')
  })

  it('远端版本相同 → latest', async () => {
    stubFetch(async () => jsonResponse(manifest({ version: APP_VERSION, publishedAt: '2026-10-09' })))
    const r: UpdateCheckResult = await checkForUpdate({
      url: MANIFEST_URL,
      currentVersion: APP_VERSION
    })

    expect(r.ok).toBe(true)
    expect(r.status).toBe('latest')
    expect(r.upToDate).toBe(true)
    expect(r.message).toBe(`当前已是最新版本 v${APP_VERSION}`)
    // 最新时也带上清单信息，界面要展示发布日期
    expect(r.info?.publishedAt).toBe('2026-10-09')
  })

  it('远端版本更旧 → 仍按最新处理（不为旧清单弹下载）', async () => {
    stubFetch(async () => jsonResponse(manifest({ version: '0.9.9' })))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(true)
    expect(r.status).toBe('latest')
    expect(r.upToDate).toBe(true)
  })

  it('缺省 URL 时请求官方清单地址，并带缓存穿透参数', async () => {
    const calls = stubFetch(async () => jsonResponse(manifest({ version: APP_VERSION })))
    const r: UpdateCheckResult = await checkForUpdate({ currentVersion: APP_VERSION })

    expect(r.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith(UPDATE_MANIFEST_URL)).toBe(true)
    expect(calls[0].url).toContain('_=')
  })

  it('清单缺可选字段也能用（只要求 version 与 downloadUrl）', async () => {
    stubFetch(async () =>
      jsonResponse({ version: '9.9.9', downloadUrl: 'https://example.com/g.exe' })
    )
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(true)
    expect(r.status).toBe('available')
    expect(r.info?.notes).toEqual([])
    expect(r.info?.publishedAt).toBe('')
    expect(r.info?.sha256).toBe('')
    expect(r.info?.size).toBe(0)
    expect(r.info?.mandatory).toBe(false)
  })
})

describe('checkForUpdate：失败一律不抛异常', () => {
  it('HTTP 500', async () => {
    stubFetch(async () => jsonResponse({ error: 'boom' }, 500))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.status).toBe('error')
    expect(r.info).toBeUndefined()
    expect(r.message).toContain('HTTP 500')
  })

  it('请求超时：到点即失败，不等底层 fetch', async () => {
    stubFetch(() => new Promise<Response>(() => {}))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL, timeoutMs: 30 })

    expect(r.ok).toBe(false)
    expect(r.status).toBe('error')
    expect(r.message).toContain('暂时无法检查更新')
  })

  it('网络异常（fetch failed）', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('暂时无法检查更新')
  })

  it('AbortError 也算网络类失败', async () => {
    stubFetch(async () => {
      const e = new Error('This operation was aborted')
      e.name = 'AbortError'
      throw e
    })
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('暂时无法检查更新')
  })

  it('返回的不是 JSON（坏清单）', async () => {
    stubFetch(async () => new Response('not-json-at-all', { status: 200 }))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.status).toBe('error')
  })

  it('根对象是数组也算坏清单', async () => {
    stubFetch(async () => jsonResponse([1, 2, 3]))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('版本清单')
  })

  it('缺 version 字段', async () => {
    const raw = manifest()
    delete raw.version
    stubFetch(async () => jsonResponse(raw))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('缺少 version')
  })

  it('缺 downloadUrl 字段', async () => {
    const raw = manifest()
    delete raw.downloadUrl
    stubFetch(async () => jsonResponse(raw))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('缺少 downloadUrl')
  })

  it('downloadUrl 不是 http(s)', async () => {
    stubFetch(async () => jsonResponse(manifest({ downloadUrl: 'javascript:alert(1)' })))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('下载地址无效')
  })

  it('版本号格式不合法（如 1.0）', async () => {
    stubFetch(async () => jsonResponse(manifest({ version: '1.0' })))
    const r: UpdateCheckResult = await checkForUpdate({ url: MANIFEST_URL })

    expect(r.ok).toBe(false)
    expect(r.message).toContain('版本号格式不合法')
  })
})

describe('checkForUpdate：外部请求不带任何应用来源', () => {
  it('不追加 origin / referer（区别于云端 fetchWithAuthOrigin）', async () => {
    const calls = stubFetch(async () => jsonResponse(manifest()))
    await checkForUpdate({ url: MANIFEST_URL })

    const headers = new Headers(calls[0].init?.headers ?? {})
    expect(headers.get('origin')).toBeNull()
    expect(headers.get('referer')).toBeNull()
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('accept')).toBe('application/json')
  })

  it('带上 signal 以便超时后释放底层连接', async () => {
    const calls = stubFetch(async () => jsonResponse(manifest()))
    await checkForUpdate({ url: MANIFEST_URL, timeoutMs: 1000 })
    expect(calls[0].init?.signal).toBeDefined()
  })
})
