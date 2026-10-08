import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'
import { applyMigrations } from '../../src/main/db/schema'
import { Db } from '../../src/main/services/db-wrapper'
import {
  TermLibraryService,
  seedBuiltinTerms
} from '../../src/main/services/term-library'

const RESOURCES = join(__dirname, '..', '..', 'resources')

function freshDb(): Db {
  const p = join(tmpdir(), `gt-terms-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Db(p)
  applyMigrations(db)
  return db
}

describe('内置术语库种子', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
  })

  it('首次播种写入 4 个内置库与全部词条，再次启动不重复播种', () => {
    const first = seedBuiltinTerms(db, RESOURCES)
    expect(first.libs).toBe(4)
    expect(first.terms).toBeGreaterThanOrEqual(160) // 每库 ≥40

    const svc = new TermLibraryService(db)
    expect(svc.listLibs()).toHaveLength(4)
    for (const game of ['dota2', 'lol', 'pubg', 'cs2']) {
      const lib = svc.getLibByGame(game)!
      expect(lib).toBeTruthy()
      expect(lib.is_builtin).toBe(1)
      expect(svc.countTerms(lib.id)).toBeGreaterThanOrEqual(40)
    }

    const second = seedBuiltinTerms(db, RESOURCES)
    expect(second.libs).toBe(0)
    expect(second.terms).toBe(0)
    expect(svc.listLibs()).toHaveLength(4)
  })

  it('resources/terms 不存在时安全返回 0', () => {
    const r = seedBuiltinTerms(db, join(tmpdir(), 'no-such-dir-xyz'))
    expect(r).toEqual({ libs: 0, terms: 0 })
  })
})

describe('术语库与词条管理', () => {
  let db: Db
  let svc: TermLibraryService
  beforeEach(() => {
    db = freshDb()
    seedBuiltinTerms(db, RESOURCES)
    svc = new TermLibraryService(db)
  })

  it('搜索按原文或译文模糊匹配', () => {
    const dota = svc.getLibByGame('dota2')!
    const r1 = svc.listTerms(dota.id, 'gank')
    expect(r1.some((t) => t.source_text === 'gank')).toBe(true)
    const r2 = svc.listTerms(dota.id, '抓人')
    expect(r2.some((t) => t.target_text === '抓人')).toBe(true)
  })

  it('新增词条标记为自定义，可编辑可删除', () => {
    const dota = svc.getLibByGame('dota2')!
    const before = svc.countTerms(dota.id)
    const id = svc.createTerm(dota.id, { source_text: 'gl hf', target_text: '祝好运玩得爽', tag: '社交' })
    expect(svc.countTerms(dota.id)).toBe(before + 1)
    const created = svc.listTerms(dota.id).find((t) => t.id === id)!
    expect(created.is_custom).toBe(1)

    svc.updateTerm(id, { source_text: 'gl hf', target_text: '祝好运玩得开心' })
    const updated = svc.listTerms(dota.id).find((t) => t.id === id)!
    expect(updated.target_text).toBe('祝好运玩得开心')

    svc.deleteTerm(id)
    expect(svc.countTerms(dota.id)).toBe(before)
  })

  it('内置库不可删除，自定义库可删除且词条级联清除', () => {
    const dota = svc.getLibByGame('dota2')!
    expect(() => svc.deleteLib(dota.id)).toThrow(/内置/)

    const libId = svc.createLib({ name: '我的词库' })
    svc.createTerm(libId, { source_text: 'a', target_text: '甲' })
    svc.createTerm(libId, { source_text: 'b', target_text: '乙' })
    expect(svc.countTerms(libId)).toBe(2)
    svc.deleteLib(libId)
    expect(svc.listLibs().find((l) => l.id === libId)).toBeUndefined()
    expect(svc.countTerms(libId)).toBe(0)
  })
})
