import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Db } from './db-wrapper'

export interface LibRow {
  id: number
  game: string
  name: string
  version: string
  source_url: string | null
  is_builtin: number
  term_count: number
  updated_at: string
}

export interface TermRow {
  id: number
  lib_id: number
  source_text: string
  target_text: string
  tag: string | null
  is_custom: number
  updated_at: string
}

export interface TermInput {
  source_text: string
  target_text: string
  tag?: string
}

export interface BuiltinTermFile {
  game: string
  name: string
  version: string
  terms: Array<{ source: string; target: string; tag?: string }>
}

export class TermLibraryService {
  constructor(private db: Db) {}

  listLibs(): LibRow[] {
    return this.db
      .prepare(
        `SELECT l.*,
                (SELECT COUNT(*) FROM terms t WHERE t.lib_id = l.id) AS term_count
         FROM term_libraries l
         ORDER BY l.is_builtin DESC, l.id ASC`
      )
      .all() as LibRow[]
  }

  getLib(id: number): LibRow {
    return this.db.prepare('SELECT * FROM term_libraries WHERE id = ?').get(id) as LibRow
  }

  getLibByGame(game: string): LibRow | undefined {
    return this.db
      .prepare('SELECT * FROM term_libraries WHERE game = ?')
      .get(game) as LibRow | undefined
  }

  createLib(input: { name: string; game?: string; source_url?: string }): number {
    const now = new Date().toISOString()
    const r = this.db
      .prepare(
        'INSERT INTO term_libraries (game, name, source_url, is_builtin, updated_at) VALUES (?,?,?,0,?)'
      )
      .run(input.game ?? `custom_${Date.now()}`, input.name, input.source_url ?? null, now)
    return Number(r.lastInsertRowid)
  }

  renameLib(id: number, name: string): void {
    this.db
      .prepare('UPDATE term_libraries SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, new Date().toISOString(), id)
  }

  // 仅允许删除自定义库；内置库由更新机制维护
  deleteLib(id: number): void {
    const lib = this.getLib(id)
    if (!lib) throw new Error('术语库不存在')
    if (lib.is_builtin === 1) throw new Error('内置术语库不能删除，可在设置中选择其他库')
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM terms WHERE lib_id = ?').run(id)
      this.db.prepare('DELETE FROM term_libraries WHERE id = ?').run(id)
    })
    tx()
  }

  listTerms(libId: number, search?: string): TermRow[] {
    if (search && search.trim()) {
      const like = '%' + search.trim() + '%'
      return this.db
        .prepare(
          'SELECT * FROM terms WHERE lib_id = ? AND (source_text LIKE ? OR target_text LIKE ?) ORDER BY id ASC'
        )
        .all(libId, like, like) as TermRow[]
    }
    return this.db
      .prepare('SELECT * FROM terms WHERE lib_id = ? ORDER BY id ASC')
      .all(libId) as TermRow[]
  }

  countTerms(libId: number): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS n FROM terms WHERE lib_id = ?')
      .get(libId) as { n: number }
    return Number(r.n)
  }

  createTerm(libId: number, input: TermInput): number {
    const now = new Date().toISOString()
    const r = this.db
      .prepare(
        'INSERT INTO terms (lib_id, source_text, target_text, tag, is_custom, updated_at) VALUES (?,?,?,?,1,?)'
      )
      .run(libId, input.source_text, input.target_text, input.tag ?? null, now)
    return Number(r.lastInsertRowid)
  }

  updateTerm(id: number, input: TermInput): void {
    this.db
      .prepare(
        'UPDATE terms SET source_text = ?, target_text = ?, tag = ?, is_custom = 1, updated_at = ? WHERE id = ?'
      )
      .run(input.source_text, input.target_text, input.tag ?? null, new Date().toISOString(), id)
  }

  deleteTerm(id: number): void {
    this.db.prepare('DELETE FROM terms WHERE id = ?').run(id)
  }

  bulkInsertTerms(
    libId: number,
    terms: Array<{ source: string; target: string; tag?: string }>,
    isCustom: boolean
  ): number {
    const tx = this.db.transaction(() => this.insertTermsNoTx(libId, terms, isCustom))
    tx()
    return terms.length
  }

  // 不自行开启事务，供外层事务调用（如导入、更新合并）
  insertTermsNoTx(
    libId: number,
    terms: Array<{ source: string; target: string; tag?: string }>,
    isCustom: boolean
  ): number {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      'INSERT INTO terms (lib_id, source_text, target_text, tag, is_custom, updated_at) VALUES (?,?,?,?,?,?)'
    )
    for (const t of terms) stmt.run(libId, t.source, t.target, t.tag ?? null, isCustom ? 1 : 0, now)
    return terms.length
  }
}

// 首次启动种子：内置库不存在才写入，重复启动不重复播种
export function seedBuiltinTerms(db: Db, resourcesRoot: string): { libs: number; terms: number } {
  const svc = new TermLibraryService(db)
  const dir = join(resourcesRoot, 'terms')
  let libsAdded = 0
  let termsAdded = 0

  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return { libs: 0, terms: 0 }
  }

  for (const file of files) {
    const data = JSON.parse(
      readFileSync(join(dir, file), 'utf8')
    ) as BuiltinTermFile
    if (svc.getLibByGame(data.game)) continue
    const now = new Date().toISOString()
    const r = db
      .prepare(
        'INSERT INTO term_libraries (game, name, version, source_url, is_builtin, updated_at) VALUES (?,?,?,?,1,?)'
      )
      .run(data.game, data.name, data.version ?? '0', null, now)
    const libId = Number(r.lastInsertRowid)
    termsAdded += svc.bulkInsertTerms(libId, data.terms, false)
    libsAdded += 1
  }

  return { libs: libsAdded, terms: termsAdded }
}
