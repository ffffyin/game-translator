import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { seedBuiltinTerms, TermLibraryService } from '../../src/main/services/term-library'
import { buildExportJson, validateTermFile, importTermFile } from '../../src/main/services/term-io'

const RESOURCES = join(__dirname, '..', '..', 'resources')

function dbWithSeeds(): Db {
  const p = join(tmpdir(), `gt-io-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Db(p)
  applyMigrations(db)
  seedBuiltinTerms(db, RESOURCES)
  return db
}

describe('validateTermFile 导入校验', () => {
  it('接受合法文件', () => {
    const r = validateTermFile({
      name: '测试库',
      terms: [{ source: 'a', target: '甲' }, { source: 'b', target: '乙', tag: '战术' }]
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.terms).toHaveLength(2)
  })

  it('拒绝非对象、缺 name、缺 terms', () => {
    expect(validateTermFile('x').ok).toBe(false)
    expect(validateTermFile({ terms: [] }).ok).toBe(false)
    expect(validateTermFile({ name: 'x' }).ok).toBe(false)
  })

  it('拒绝坏词条并指出序号', () => {
    const r = validateTermFile({
      name: 'x',
      terms: [{ source: 'a' }, { source: 'b', target: '乙' }]
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('第 1 条')
  })
})

describe('导入导出闭环', () => {
  let db: Db
  beforeEach(() => {
    db = dbWithSeeds()
  })

  it('导出内置库再导入，内容不丢且成为自定义库', () => {
    const svc = new TermLibraryService(db)
    const dota = svc.getLibByGame('dota2')!
    const exported = buildExportJson(db, dota.id)
    expect(exported.terms.length).toBeGreaterThanOrEqual(40)

    const v = validateTermFile(exported)
    expect(v.ok).toBe(true)
    if (!v.ok) return

    const r = importTermFile(db, v.data)
    expect(r.ok).toBe(true)
    expect(r.count).toBe(exported.terms.length)

    const libs = svc.listLibs()
    const imported = libs.find((l) => l.name === 'Dota 2（导入）')!
    expect(imported).toBeTruthy()
    expect(imported.is_builtin).toBe(0)
    const importedTerms = svc.listTerms(imported.id)
    expect(importedTerms).toHaveLength(exported.terms.length)
    expect(importedTerms.every((t) => t.is_custom === 1)).toBe(true)
  })
})
