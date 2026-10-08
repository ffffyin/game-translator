import { readFileSync } from 'fs'
import { join } from 'path'
import type { Db } from './db-wrapper'

// 每页固定 8 个槽位（Alt+1 ~ Alt+8）
export const PHRASE_SLOTS = 8

export interface PhraseRow {
  id: number
  page_id: number | null
  slot: number
  content: string
  accelerator: string
  sort_order: number
  enabled: number
  is_custom: number
  updated_at: string
}

export interface PhrasePageRow {
  id: number
  name: string
  note: string | null
  sort_order: number
  is_active: number
  is_builtin: number
  updated_at: string
}

export type PhrasePageWithCount = PhrasePageRow & { count: number }

interface SeedPage {
  name: string
  note?: string
  phrases: string[]
}

interface DefaultPhraseFile {
  phrases: Array<{ slot: number; content: string; accelerator?: string }>
}

function acceleratorFor(order: number): string {
  return order >= 1 && order <= PHRASE_SLOTS ? `Alt+${order}` : ''
}

export class PhraseService {
  constructor(private db: Db) {}

  // ---------- 页面 ----------

  listPages(): PhrasePageWithCount[] {
    return this.db
      .prepare(
        `SELECT p.*, (SELECT COUNT(*) FROM phrases WHERE page_id = p.id) AS count
         FROM phrase_pages p
         ORDER BY p.sort_order ASC, p.id ASC`
      )
      .all() as PhrasePageWithCount[]
  }

  getPage(id: number): PhrasePageRow | undefined {
    return this.db.prepare('SELECT * FROM phrase_pages WHERE id = ?').get(id) as
      | PhrasePageRow
      | undefined
  }

  // 当前生效页：is_active=1；数据异常（没有活动页）时回落到第一页
  activePage(): PhrasePageRow | undefined {
    const active = this.db
      .prepare('SELECT * FROM phrase_pages WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
      .get() as PhrasePageRow | undefined
    if (active) return active
    return this.db
      .prepare('SELECT * FROM phrase_pages ORDER BY sort_order ASC, id ASC')
      .get() as PhrasePageRow | undefined
  }

  activePageId(): number | null {
    return this.activePage()?.id ?? null
  }

  setActivePage(id: number): void {
    if (!this.getPage(id)) return
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE phrase_pages SET is_active = 0').run()
      this.db
        .prepare('UPDATE phrase_pages SET is_active = 1, updated_at = ? WHERE id = ?')
        .run(new Date().toISOString(), id)
    })
    tx()
  }

  createPage(name: string, note?: string): number {
    const rows = this.listPages()
    const order = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 1
    const now = new Date().toISOString()
    const r = this.db
      .prepare(
        `INSERT INTO phrase_pages (name, note, sort_order, is_active, is_builtin, updated_at)
         VALUES (?,?,?,?,0,?)`
      )
      .run(name, note ?? null, order, rows.length === 0 ? 1 : 0, now)
    return Number(r.lastInsertRowid)
  }

  updatePage(id: number, patch: { name?: string; note?: string | null }): void {
    const cur = this.getPage(id)
    if (!cur) return
    const name = patch.name?.trim() ? patch.name.trim() : cur.name
    const note = patch.note === undefined ? cur.note : patch.note
    this.db
      .prepare('UPDATE phrase_pages SET name = ?, note = ?, is_builtin = ?, updated_at = ? WHERE id = ?')
      .run(name, note ?? null, 0, new Date().toISOString(), id)
  }

  // 删除页（连同页内常用语）；至少保留一页；删掉活动页时自动把第一页设为活动页
  removePage(id: number): { ok: boolean; error?: string } {
    const pages = this.listPages()
    if (pages.length <= 1) return { ok: false, error: '至少要保留一个常用语页' }
    const page = this.getPage(id)
    if (!page) return { ok: false, error: '页面不存在' }
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM phrases WHERE page_id = ?').run(id)
      this.db.prepare('DELETE FROM phrase_pages WHERE id = ?').run(id)
    })
    tx()
    if (page.is_active === 1) {
      const first = this.listPages()[0]
      if (first) this.setActivePage(first.id)
    }
    return { ok: true }
  }

  // ---------- 常用语 ----------

  list(pageId?: number): PhraseRow[] {
    const pid = pageId ?? this.activePageId()
    if (pid == null) return []
    return this.db
      .prepare('SELECT * FROM phrases WHERE page_id = ? ORDER BY sort_order ASC, id ASC')
      .all(pid) as PhraseRow[]
  }

  listEnabled(pageId?: number): PhraseRow[] {
    return this.list(pageId).filter((p) => p.enabled === 1)
  }

  // 快捷键只绑定「当前页」的常用语（其它页的同名 Alt+N 不注册，避免互相冲突）
  listEnabledActive(): PhraseRow[] {
    return this.listEnabled(this.activePageId() ?? undefined)
  }

  get(id: number): PhraseRow {
    return this.db.prepare('SELECT * FROM phrases WHERE id = ?').get(id) as PhraseRow
  }

  create(content: string, pageId?: number): number {
    const pid = pageId ?? this.activePageId()
    if (pid == null) throw new Error('没有可用的常用语页')
    const rows = this.list(pid)
    const sortOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 1
    const now = new Date().toISOString()
    const r = this.db
      .prepare(
        `INSERT INTO phrases (page_id, slot, content, accelerator, sort_order, enabled, is_custom, updated_at)
         VALUES (?,?,?,?,?,1,1,?)`
      )
      .run(pid, sortOrder, content, acceleratorFor(sortOrder), sortOrder, now)
    return Number(r.lastInsertRowid)
  }

  updateContent(id: number, content: string): void {
    this.db
      .prepare('UPDATE phrases SET content = ?, is_custom = 1, updated_at = ? WHERE id = ?')
      .run(content, new Date().toISOString(), id)
  }

  setEnabled(id: number, enabled: boolean): void {
    this.db.prepare('UPDATE phrases SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id)
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM phrases WHERE id = ?').run(id)
  }

  // 上移 / 下移：与同页相邻行交换 sort_order，并同步槽位快捷键
  move(id: number, direction: 'up' | 'down'): void {
    const row = this.get(id)
    if (!row) return
    const rows = this.list(row.page_id ?? undefined)
    const idx = rows.findIndex((r) => r.id === id)
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return
    const a = rows[idx]
    const b = rows[swapWith]
    const tx = this.db.transaction(() => {
      const upd = this.db.prepare(
        'UPDATE phrases SET sort_order = ?, slot = ?, accelerator = ? WHERE id = ?'
      )
      upd.run(b.sort_order, b.sort_order, acceleratorFor(b.sort_order), a.id)
      upd.run(a.sort_order, a.sort_order, acceleratorFor(a.sort_order), b.id)
    })
    tx()
  }

  // 老库升级：把没有归页的常用语放进默认页，并保证有且只有一个活动页
  ensurePages(): number {
    const pages = this.listPages()
    if (pages.length === 0) return 0
    const activeId = this.activePageId()!
    if (pages.filter((p) => p.is_active === 1).length !== 1) this.setActivePage(activeId)
    const r = this.db
      .prepare('UPDATE phrases SET page_id = ? WHERE page_id IS NULL')
      .run(activeId)
    return Number(r.changes)
  }
}

// 常用语种子：全新安装才按 pages.json 播种（既建页也播种），重复启动不重复播种
export function seedDefaultPhrases(db: Db, resourcesRoot: string): number {
  const svc = new PhraseService(db)

  if (svc.listPages().length > 0) {
    svc.ensurePages()
    return 0
  }

  // 老库升级（已有常用语但没有分页表）：把这些条目归入自动新建的「默认」页，
  // 绝不能拿种子内容去覆盖用户自己写的话术
  const existing = db.prepare('SELECT COUNT(*) AS n FROM phrases').get() as { n: number }
  if (existing.n > 0) {
    const pageId = svc.createPage('默认', '升级后自动建立的常用语页')
    db.prepare('UPDATE phrases SET page_id = ? WHERE page_id IS NULL').run(pageId)
    svc.setActivePage(pageId)
    return 0
  }

  const pages = loadSeedPages(resourcesRoot)
  if (!pages.length) return 0

  const now = new Date().toISOString()
  const insertPage = db.prepare(
    `INSERT INTO phrase_pages (name, note, sort_order, is_active, is_builtin, updated_at)
     VALUES (?,?,?,?,1,?)`
  )
  const insertPhrase = db.prepare(
    `INSERT INTO phrases (page_id, slot, content, accelerator, sort_order, enabled, is_custom, updated_at)
     VALUES (?,?,?,?,?,1,0,?)`
  )

  let total = 0
  const tx = db.transaction(() => {
    pages.forEach((page, pi) => {
      const r = insertPage.run(page.name, page.note ?? null, pi + 1, pi === 0 ? 1 : 0, now)
      const pageId = Number(r.lastInsertRowid)
      page.phrases.forEach((content, i) => {
        const order = i + 1
        insertPhrase.run(pageId, order, content, acceleratorFor(order), order, now)
        total += 1
      })
    })
  })
  tx()
  return total
}

// 优先读 pages.json（多页种子），缺失时回落到老的 default.json（单页）
function loadSeedPages(resourcesRoot: string): SeedPage[] {
  try {
    const raw = JSON.parse(
      readFileSync(join(resourcesRoot, 'phrases', 'pages.json'), 'utf8')
    ) as { pages?: SeedPage[] }
    const pages = (raw.pages ?? []).filter((p) => p && p.name && Array.isArray(p.phrases))
    if (pages.length) return pages
  } catch {
    // 继续尝试老格式
  }
  try {
    const old = JSON.parse(
      readFileSync(join(resourcesRoot, 'phrases', 'default.json'), 'utf8')
    ) as DefaultPhraseFile
    if (!old.phrases?.length) return []
    return [{ name: '默认', note: '通用常用语', phrases: old.phrases.map((p) => p.content) }]
  } catch {
    return []
  }
}
