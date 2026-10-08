import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { matchTerms, resolveGlossary } from '../../src/main/services/term-match'
import { seedBuiltinTerms } from '../../src/main/services/term-library'
import type { AppSettings } from '../../src/shared/defaults'

const RESOURCES = join(__dirname, '..', '..', 'resources')

function dbWithSeeds(): Db {
  const p = join(tmpdir(), `gt-match-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Db(p)
  applyMigrations(db)
  seedBuiltinTerms(db, RESOURCES)
  return db
}

describe('matchTerms 术语命中', () => {
  const terms = [
    { source_text: 'gank', target_text: '抓人' },
    { source_text: 'first blood', target_text: '一血' },
    { source_text: '4x', target_text: '四倍镜' },
    { source_text: 'BKB', target_text: '黑皇杖' }
  ]

  it('命中句中单词（大小写不敏感）', () => {
    const hits = matchTerms("let's GANK mid", terms)
    expect(hits.find((h) => h.source_text === 'gank')?.target_text).toBe('抓人')
  })

  it('词边界：ganker 不命中 gank', () => {
    const hits = matchTerms('he is a ganker', terms)
    expect(hits.find((h) => h.source_text === 'gank')).toBeUndefined()
  })

  it('命中多词短语', () => {
    const hits = matchTerms('they got first blood top', terms)
    expect(hits.find((h) => h.source_text === 'first blood')?.target_text).toBe('一血')
  })

  it('含数字的缩写按子串命中', () => {
    const hits = matchTerms('i need a 4x scope', terms)
    expect(hits.find((h) => h.source_text === '4x')?.target_text).toBe('四倍镜')
  })

  it('长词优先且同原文去重', () => {
    const dup = [
      { source_text: 'gank', target_text: '抓人' },
      { source_text: 'gank', target_text: '抓人' }
    ]
    const hits = matchTerms('gank now', dup)
    expect(hits).toHaveLength(1)
  })
})

describe('resolveGlossary 按设置解析', () => {
  let db: Db
  beforeEach(() => {
    db = dbWithSeeds()
  })

  it('选择 dota2 库时命中内置词条', () => {
    const settings = { termLibrary: 'dota2' } as AppSettings
    const hits = resolveGlossary(db, settings, 'they want to gank mid, bkb ready')
    expect(hits.some((h) => h.source_text === 'gank' && h.target_text === '抓人')).toBe(true)
    expect(hits.some((h) => h.source_text === 'BKB' && h.target_text === '黑皇杖')).toBe(true)
  })

  it('同一句原文选不同术语库命中不同词条（验收 17）', () => {
    const text = 'gank bkb roshan baron dragon'
    const dota = resolveGlossary(db, { termLibrary: 'dota2' } as AppSettings, text)
    const lol = resolveGlossary(db, { termLibrary: 'lol' } as AppSettings, text)
    expect(dota.some((h) => h.source_text === 'BKB')).toBe(true)
    expect(dota.some((h) => h.source_text === 'roshan')).toBe(true)
    expect(lol.some((h) => h.source_text === 'baron')).toBe(true)
    expect(lol.some((h) => h.source_text === 'dragon')).toBe(true)
    // 两库注入的术语对照不同 → 同一句原文的译文不同
    expect(dota.map((h) => h.source_text).sort()).not.toEqual(
      lol.map((h) => h.source_text).sort()
    )
  })

  it('general 通用模式不注入术语', () => {
    const settings = { termLibrary: 'general' } as AppSettings
    expect(resolveGlossary(db, settings, 'gank')).toEqual([])
  })

  it('不存在的库安全返回空', () => {
    const settings = { termLibrary: 'nope' } as AppSettings
    expect(resolveGlossary(db, settings, 'gank')).toEqual([])
  })
})
