import type { Db } from './db-wrapper'
import { TermLibraryService, type BuiltinTermFile } from './term-library'

export interface IoResult {
  ok: boolean
  message: string
  count?: number
  libId?: number
}

// 构造导出内容
export function buildExportJson(db: Db, libId: number): BuiltinTermFile {
  const svc = new TermLibraryService(db)
  const lib = svc.getLib(libId)
  if (!lib) throw new Error('术语库不存在')
  const terms = svc.listTerms(libId).map((t) => ({
    source: t.source_text,
    target: t.target_text,
    ...(t.tag ? { tag: t.tag } : {})
  }))
  return { game: lib.game, name: lib.name, version: lib.version, terms }
}

// 校验导入文件内容；纯函数，供单元测试
export function validateTermFile(raw: unknown): { ok: true; data: BuiltinTermFile } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: '文件内容不是有效的 JSON 对象' }
  const o = raw as Record<string, unknown>
  if (typeof o.name !== 'string' || !o.name.trim()) return { ok: false, error: '缺少 name（术语库名称）字段' }
  if (!Array.isArray(o.terms)) return { ok: false, error: '缺少 terms（词条数组）字段' }
  const terms: BuiltinTermFile['terms'] = []
  for (let i = 0; i < o.terms.length; i++) {
    const t = o.terms[i] as Record<string, unknown>
    if (
      typeof t !== 'object' ||
      t === null ||
      typeof t.source !== 'string' ||
      !t.source.trim() ||
      typeof t.target !== 'string' ||
      !t.target.trim()
    ) {
      return { ok: false, error: `第 ${i + 1} 条词条缺少 source 或 target` }
    }
    terms.push({
      source: t.source,
      target: t.target,
      ...(typeof t.tag === 'string' && t.tag.trim() ? { tag: t.tag } : {})
    })
  }
  return {
    ok: true,
    data: {
      game: typeof o.game === 'string' ? o.game : `imported_${Date.now()}`,
      name: o.name,
      version: typeof o.version === 'string' ? o.version : '0',
      terms
    }
  }
}

// 导入：校验通过后创建为自定义术语库，词条全部标记为自定义
export function importTermFile(db: Db, data: BuiltinTermFile): IoResult {
  const svc = new TermLibraryService(db)
  let name = data.name
  const existing = new Set(svc.listLibs().map((l) => l.name))
  if (existing.has(name)) name = `${name}（导入）`
  const tx = db.transaction(() => {
    const libId = svc.createLib({ name, game: `imported_${Date.now()}` })
    svc.insertTermsNoTx(libId, data.terms, true)
    return libId
  })
  const libId = tx()
  return { ok: true, message: `已导入「${name}」，共 ${data.terms.length} 条`, count: data.terms.length, libId }
}
