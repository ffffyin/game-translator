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

describe('常用语种子（多页）', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
  })

  it('首启按 pages.json 建页并播种，每页 8 条绑定 Alt+1~8，重复启动不重复播种', () => {
    const n = seedDefaultPhrases(db, RESOURCES)
    expect(n).toBe(40)

    const svc = new PhraseService(db)
    const pages = svc.listPages()
    expect(pages.map((p) => p.name)).toEqual(['通用', 'Dota2', 'LOL', 'CS2', 'PUBG'])
    pages.forEach((p) => expect(p.count).toBe(8))
    // 第一页为当前生效页，且唯一
    expect(pages[0].is_active).toBe(1)
    expect(pages.filter((p) => p.is_active === 1)).toHaveLength(1)

    const rows = svc.list(pages[0].id)
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

  it('老库升级：已有常用语不播种、不覆盖，归入自动新建的默认页', () => {
    const now = new Date().toISOString()
    const ins = db.prepare(
      `INSERT INTO phrases (page_id, slot, content, accelerator, sort_order, enabled, is_custom, updated_at)
       VALUES (NULL,?,?,?,?,1,1,?)`
    )
    ins.run(1, '我自己写的话术', 'Alt+1', 1, now)
    ins.run(2, '第二条', 'Alt+2', 2, now)

    expect(seedDefaultPhrases(db, RESOURCES)).toBe(0)

    const svc = new PhraseService(db)
    const pages = svc.listPages()
    expect(pages).toHaveLength(1)
    expect(pages[0].name).toBe('默认')
    expect(pages[0].count).toBe(2)
    expect(pages[0].is_active).toBe(1)
    expect(svc.list(pages[0].id).map((p) => p.content)).toEqual([
      '我自己写的话术',
      '第二条'
    ])
  })
})

describe('常用语分页管理', () => {
  let db: Db
  let svc: PhraseService
  beforeEach(() => {
    db = freshDb()
    seedDefaultPhrases(db, RESOURCES)
    svc = new PhraseService(db)
  })

  it('新建页排在末尾且不抢占当前页；可改名与备注', () => {
    const id = svc.createPage('我的报点页', '自定义')
    const pages = svc.listPages()
    expect(pages[pages.length - 1].name).toBe('我的报点页')
    expect(pages[pages.length - 1].is_active).toBe(0)
    expect(svc.activePage()!.name).toBe('通用')

    svc.updatePage(id, { name: '报点', note: '只放报点' })
    const p = svc.getPage(id)!
    expect(p.name).toBe('报点')
    expect(p.note).toBe('只放报点')
  })

  it('切换当前页后，默认列表与快捷键集合都跟着走', () => {
    const dota = svc.listPages().find((p) => p.name === 'Dota2')!
    svc.setActivePage(dota.id)
    expect(svc.activePageId()).toBe(dota.id)
    expect(svc.list()[0].content).toBe('中路不见了，注意')
    expect(svc.listEnabledActive().every((p) => p.page_id === dota.id)).toBe(true)
    expect(svc.listEnabledActive()).toHaveLength(8)
  })

  it('删除页面连同条目一起删除；删掉当前页会自动把第一页设为当前页', () => {
    const pages = svc.listPages()
    const dota = pages.find((p) => p.name === 'Dota2')!
    svc.setActivePage(dota.id)
    expect(svc.removePage(dota.id).ok).toBe(true)
    expect(svc.listPages().find((p) => p.id === dota.id)).toBeUndefined()
    expect(svc.list(dota.id)).toHaveLength(0)
    expect(svc.activePage()!.name).toBe('通用')
  })

  it('至少保留一个页面', () => {
    const pages = svc.listPages()
    pages.slice(1).forEach((p) => svc.removePage(p.id))
    expect(svc.listPages()).toHaveLength(1)
    const r = svc.removePage(svc.listPages()[0].id)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('至少')
  })
})

describe('常用语管理（页内）', () => {
  let db: Db
  let svc: PhraseService
  beforeEach(() => {
    db = freshDb()
    seedDefaultPhrases(db, RESOURCES)
    svc = new PhraseService(db)
  })

  it('新增排在当前页末尾，超过 8 条无快捷键', () => {
    const id = svc.create('第九条')
    const rows = svc.list()
    expect(rows).toHaveLength(9)
    expect(rows[rows.length - 1].id).toBe(id)
    expect(rows[rows.length - 1].accelerator).toBe('')
  })

  it('新增到指定页时不会落到当前页', () => {
    const cs2 = svc.listPages().find((p) => p.name === 'CS2')!
    const id = svc.create('自定义 CS2 话术', cs2.id)
    expect(svc.get(id).page_id).toBe(cs2.id)
    expect(svc.list(cs2.id)).toHaveLength(9)
    expect(svc.list()).toHaveLength(8)
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

  it('上移/下移在页内交换顺序并同步槽位快捷键', () => {
    const rows = svc.list()
    const secondId = rows[1].id
    svc.move(secondId, 'up')
    const after = svc.list()
    expect(after[0].id).toBe(secondId)
    expect(after[0].accelerator).toBe('Alt+1')
    expect(after[1].accelerator).toBe('Alt+2')

    svc.move(secondId, 'down')
    expect(svc.list().map((r) => r.id).slice(0, 2)).toEqual([rows[0].id, secondId])

    svc.remove(rows[0].id)
    expect(svc.list()).toHaveLength(7)
  })

  it('跨页移动不会串页（页边界处不交换）', () => {
    const first = svc.list()[0]
    svc.move(first.id, 'up')
    expect(svc.list()[0].id).toBe(first.id)
  })
})
