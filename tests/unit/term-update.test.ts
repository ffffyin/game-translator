import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { seedBuiltinTerms, TermLibraryService } from '../../src/main/services/term-library'
import {
  isValidHttpUrl,
  checkForUpdates,
  applyUpdates,
  mergeLibraryData
} from '../../src/main/services/term-update'
import type { BuiltinTermFile } from '../../src/main/services/term-library'

const RESOURCES = join(__dirname, '..', '..', 'resources')
const MANIFEST_URL = 'https://example.com/manifest.json'

function dbWithSeeds(): Db {
  const p = join(tmpdir(), `gt-upd-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Db(p)
  applyMigrations(db)
  seedBuiltinTerms(db, RESOURCES)
  return db
}

function manifest(version: string) {
  return {
    version,
    libraries: [
      {
        game: 'dota2',
        name: 'Dota 2',
        version,
        url: `https://example.com/dota2-${version}.json`
      }
    ]
  }
}

function termFile(version: string): BuiltinTermFile {
  return {
    game: 'dota2',
    name: 'Dota 2',
    version,
    terms: [
      { source: 'gank', target: '抓人（新版）' },
      { source: 'newterm', target: '新词' }
    ]
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('更新源 URL 校验', () => {
  it('仅接受 http(s)', () => {
    expect(isValidHttpUrl('https://a.com/m.json')).toBe(true)
    expect(isValidHttpUrl('http://a.com/m.json')).toBe(true)
    expect(isValidHttpUrl('ftp://a.com/x')).toBe(false)
    expect(isValidHttpUrl('not a url')).toBe(false)
  })

  it('无效地址检查更新直接报错', async () => {
    const db = dbWithSeeds()
    await expect(checkForUpdates(db, 'bad')).rejects.toThrow(/无效/)
  })
})

describe('checkForUpdates', () => {
  it('版本不同才列入更新，坏清单报错', async () => {
    const db = dbWithSeeds()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => manifest('2026.12.01') })))
    const updates = await checkForUpdates(db, MANIFEST_URL)
    expect(updates).toHaveLength(1)
    expect(updates[0].game).toBe('dota2')
    expect(updates[0].newVersion).toBe('2026.12.01')

    // 同版本：无更新
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => manifest('2026.10.08') })))
    expect(await checkForUpdates(db, MANIFEST_URL)).toEqual([])

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ x: 1 }) })))
    await expect(checkForUpdates(db, MANIFEST_URL)).rejects.toThrow(/libraries/)
  })

  it('HTTP 非 2xx 透出状态码', async () => {
    const db = dbWithSeeds()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    await expect(checkForUpdates(db, MANIFEST_URL)).rejects.toThrow(/500/)
  })
})

describe('mergeLibraryData 合并规则', () => {
  it('内置词条按新版替换；自定义词条全保留；同原文自定义优先', () => {
    const db = dbWithSeeds()
    const svc = new TermLibraryService(db)
    const dota = svc.getLibByGame('dota2')!
    const builtinCount = svc.countTerms(dota.id)

    // 用户自定义：一条全新词条，一条对内置 gank 的修改
    svc.createTerm(dota.id, { source_text: 'mycall', target_text: '我的话术' })
    const gankTerm = svc.listTerms(dota.id).find((t) => t.source_text === 'gank')!
    svc.updateTerm(gankTerm.id, { source_text: 'gank', target_text: '用户自定的抓人' })

    const r = mergeLibraryData(db, dota.id, termFile('2026.12.01'))
    expect(r.keptCustom).toBe(2)
    // 新版含 gank/newterm，但 gank 与自定义冲突 → 只插入 newterm
    expect(r.replaced).toBe(1)

    const terms = svc.listTerms(dota.id)
    const custom = terms.filter((t) => t.is_custom === 1)
    expect(custom).toHaveLength(2)
    // 自定义 gank 译文不被覆盖
    expect(terms.find((t) => t.source_text === 'gank')?.target_text).toBe('用户自定的抓人')
    // 旧内置词条已清除（除自定义外只剩 newterm）
    const builtin = terms.filter((t) => t.is_custom === 0)
    expect(builtin).toHaveLength(1)
    expect(builtin[0].source_text).toBe('newterm')
    // 总数 = 2 自定义 + 1 内置
    expect(terms).toHaveLength(3)
    expect(svc.getLib(dota.id).version).toBe('2026.12.01')
    expect(builtinCount).toBeGreaterThan(2) // 确认旧库确实被替换过
  })
})

describe('applyUpdates 端到端', () => {
  it('清单与词库两次请求后完成更新', async () => {
    const db = dbWithSeeds()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) return { ok: true, status: 200, json: async () => manifest('2026.12.01') }
      return { ok: true, status: 200, json: async () => termFile('2026.12.01') }
    })
    vi.stubGlobal('fetch', fetchMock)
    const results = await applyUpdates(db, MANIFEST_URL)
    expect(results).toHaveLength(1)
    expect(results[0].newVersion).toBe('2026.12.01')
  })

  it('词库下载失败时抛出，且本地版本号不变', async () => {
    const db = dbWithSeeds()
    const svc = new TermLibraryService(db)
    const fetchMock = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) return { ok: true, status: 200, json: async () => manifest('2026.12.01') }
      throw new Error('network down')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(applyUpdates(db, MANIFEST_URL)).rejects.toThrow(/network down/)
    const dota = svc.getLibByGame('dota2')!
    expect(dota.version).toBe('2026.10.08')
  })
})
