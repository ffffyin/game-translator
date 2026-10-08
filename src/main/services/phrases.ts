import { readFileSync } from 'fs'
import { join } from 'path'
import type { Db } from './db-wrapper'

export interface PhraseRow {
  id: number
  slot: number
  content: string
  accelerator: string
  sort_order: number
  enabled: number
  is_custom: number
  updated_at: string
}

interface DefaultPhraseFile {
  phrases: Array<{ slot: number; content: string; accelerator: string }>
}

export class PhraseService {
  constructor(private db: Db) {}

  list(): PhraseRow[] {
    return this.db
      .prepare('SELECT * FROM phrases ORDER BY sort_order ASC, id ASC')
      .all() as PhraseRow[]
  }

  listEnabled(): PhraseRow[] {
    return this.db
      .prepare('SELECT * FROM phrases WHERE enabled = 1 ORDER BY sort_order ASC, id ASC')
      .all() as PhraseRow[]
  }

  get(id: number): PhraseRow {
    return this.db.prepare('SELECT * FROM phrases WHERE id = ?').get(id) as PhraseRow
  }

  create(content: string): number {
    const rows = this.list()
    const sortOrder = rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 1
    const slot = sortOrder
    const accelerator = slot >= 1 && slot <= 8 ? `Alt+${slot}` : ''
    const now = new Date().toISOString()
    const r = this.db
      .prepare(
        'INSERT INTO phrases (slot, content, accelerator, sort_order, enabled, is_custom, updated_at) VALUES (?,?,?,?,1,1,?)'
      )
      .run(slot, content, accelerator, sortOrder, now)
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

  // 上移 / 下移：与相邻行交换 sort_order
  move(id: number, direction: 'up' | 'down'): void {
    const rows = this.list()
    const idx = rows.findIndex((r) => r.id === id)
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (idx < 0 || swapWith < 0 || swapWith >= rows.length) return
    const a = rows[idx]
    const b = rows[swapWith]
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE phrases SET sort_order = ? WHERE id = ?').run(b.sort_order, a.id)
      this.db.prepare('UPDATE phrases SET sort_order = ? WHERE id = ?').run(a.sort_order, b.id)
    })
    tx()
  }
}

// 常用语种子：表为空才写入，重复启动不重复播种
export function seedDefaultPhrases(db: Db, resourcesRoot: string): number {
  const svc = new PhraseService(db)
  if (svc.list().length > 0) return 0

  const file = join(resourcesRoot, 'phrases', 'default.json')
  let data: DefaultPhraseFile
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return 0
  }

  const now = new Date().toISOString()
  const stmt = db.prepare(
    'INSERT INTO phrases (slot, content, accelerator, sort_order, enabled, is_custom, updated_at) VALUES (?,?,?,?,1,0,?)'
  )
  const tx = db.transaction(() => {
    for (const p of data.phrases) {
      const order = p.slot
      stmt.run(p.slot, p.content, p.accelerator, order, now)
    }
  })
  tx()
  return data.phrases.length
}
