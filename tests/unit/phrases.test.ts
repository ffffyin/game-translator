import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { PhraseService, seedDefaultPhrases } from '../../src/main/services/phrases'

const RESOURCES = join(__dirname, '..', '..', 'resources')

function freshDb(): Db {
  const p = join(tmpdir(), `gt-ph-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Db(p)
  applyMigrations(db)
  return db
}

describe('常用语种子', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
  })

  it('首启写入 8 条并绑定 Alt+1~8，重复启动不重复播种', () => {
    const n = seedDefaultPhrases(db, RESOURCES)
    expect(n).toBe(8)
    const svc = new PhraseService(db)
    const rows = svc.list()
    expect(rows).toHaveLength(8)
    rows.forEach((r, i) => {
      expect(r.accelerator).toBe(`Alt+${i + 1}`)
      expect(r.enabled).toBe(1)
      expect(r.is_custom).toBe(0)
    })
    expect(seedDefaultPhrases(db, RESOURCES)).toBe(0)
  })

  it('资源缺失时安全返回 0', () => {
    expect(seedDefaultPhrases(db, join(tmpdir(), 'no-such-xyz'))).toBe(0)
  })
})

describe('常用语管理', () => {
  let db: Db
  let svc: PhraseService
  beforeEach(() => {
    db = freshDb()
    seedDefaultPhrases(db, RESOURCES)
    svc = new PhraseService(db)
  })

  it('新增排在末尾，超过 8 条无快捷键', () => {
    const id = svc.create('第九条')
    const rows = svc.list()
    expect(rows).toHaveLength(9)
    expect(rows[rows.length - 1].id).toBe(id)
    expect(rows[rows.length - 1].accelerator).toBe('')
  })

  it('编辑内容标记为自定义，可启用/停用', () => {
    const first = svc.list()[0]
    svc.updateContent(first.id, '改后的内容')
    expect(svc.get(first.id).content).toBe('改后的内容')
    expect(svc.get(first.id).is_custom).toBe(1)

    svc.setEnabled(first.id, false)
    expect(svc.listEnabled().find((p) => p.id === first.id)).toBeUndefined()
    svc.setEnabled(first.id, true)
    expect(svc.listEnabled()).toHaveLength(8)
  })

  it('上移/下移交换顺序，删除后行数减少', () => {
    svc.move(2, 'up')
    const rows = svc.list()
    expect(rows[0].id).toBe(2)
    expect(rows[1].id).toBe(1)

    svc.move(2, 'down')
    expect(svc.list().map((r) => r.id).slice(0, 2)).toEqual([1, 2])

    svc.remove(1)
    expect(svc.list()).toHaveLength(7)
  })
})
