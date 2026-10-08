import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Db } from './db-wrapper'
import { TermLibraryService, type BuiltinTermFile } from './term-library'
import { validateTermFile } from './term-io'
import { invalidateTermCache } from './term-cache'

export interface ManifestEntry {
  game: string
  name: string
  version: string
  url: string
}

export interface Manifest {
  version: string
  libraries: ManifestEntry[]
}

export interface UpdateInfo {
  libId: number
  game: string
  name: string
  currentVersion: string
  newVersion: string
  url: string
}

export function isValidHttpUrl(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'http:' || x.protocol === 'https:'
  } catch {
    return false
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`请求失败：HTTP ${res.status}`)
  return res.json()
}

function parseManifest(raw: unknown): Manifest {
  if (typeof raw !== 'object' || raw === null) throw new Error('清单不是有效 JSON 对象')
  const o = raw as Record<string, unknown>
  if (!Array.isArray(o.libraries)) throw new Error('清单缺少 libraries 数组')
  const libraries: ManifestEntry[] = []
  for (const e of o.libraries as Array<Record<string, unknown>>) {
    if (
      typeof e.game !== 'string' ||
      typeof e.version !== 'string' ||
      typeof e.url !== 'string' ||
      !isValidHttpUrl(e.url)
    ) {
      throw new Error('清单中存在格式错误的条目（需含 game/version/url）')
    }
    libraries.push({ game: e.game, name: typeof e.name === 'string' ? e.name : e.game, version: e.version, url: e.url })
  }
  return { version: typeof o.version === 'string' ? o.version : '0', libraries }
}

// 检查可更新的术语库（只比对，不改动本地）
export async function checkForUpdates(db: Db, manifestUrl: string): Promise<UpdateInfo[]> {
  if (!isValidHttpUrl(manifestUrl)) throw new Error('更新源地址无效，需以 http(s):// 开头')
  const manifest = parseManifest(await fetchJson(manifestUrl))
  const svc = new TermLibraryService(db)
  const out: UpdateInfo[] = []
  for (const entry of manifest.libraries) {
    const lib = svc.getLibByGame(entry.game)
    if (lib && entry.version !== lib.version) {
      out.push({
        libId: lib.id,
        game: entry.game,
        name: entry.name,
        currentVersion: lib.version,
        newVersion: entry.version,
        url: entry.url
      })
    }
  }
  return out
}

// 合并单个库：内置词条按新版替换，自定义词条全部保留且同原文自定义优先
export function mergeLibraryData(db: Db, libId: number, data: BuiltinTermFile): {
  replaced: number
  keptCustom: number
} {
  const svc = new TermLibraryService(db)
  const customTerms = svc.listTerms(libId).filter((t) => t.is_custom === 1)
  const customSources = new Set(customTerms.map((t) => t.source_text.trim().toLowerCase()))
  const newBuiltin = data.terms.filter((t) => !customSources.has(t.source.trim().toLowerCase()))

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM terms WHERE lib_id = ? AND is_custom = 0').run(libId)
    svc.insertTermsNoTx(libId, newBuiltin, false)
    db.prepare('UPDATE term_libraries SET version = ?, updated_at = ? WHERE id = ?').run(
      data.version,
      new Date().toISOString(),
      libId
    )
  })
  tx()
  invalidateTermCache(libId)
  return { replaced: newBuiltin.length, keptCustom: customTerms.length }
}

// 执行更新：逐个下载、校验、合并；任一库失败则抛出且已成功的库不回滚（各库独立事务）
export async function applyUpdates(
  db: Db,
  manifestUrl: string
): Promise<Array<{ game: string; newVersion: string; replaced: number; keptCustom: number }>> {
  if (!isValidHttpUrl(manifestUrl)) throw new Error('更新源地址无效，需以 http(s):// 开头')
  const pending = await checkForUpdates(db, manifestUrl)
  const svc = new TermLibraryService(db)
  const results: Array<{ game: string; newVersion: string; replaced: number; keptCustom: number }> = []
  for (const info of pending) {
    const fileRaw = await fetchJson(info.url)
    const v = validateTermFile(fileRaw)
    if (!v.ok) throw new Error(`「${info.name}」词库文件格式错误：${v.error}`)
    const r = mergeLibraryData(db, info.libId, v.data)
    results.push({ game: info.game, newVersion: info.newVersion, ...r })
  }
  return results
}

// 启动时把随安装包带来的内置词库与数据库对齐：
// 版本不同就替换内置词条（自定义词条保留）——否则老用户升级后看不到新增术语
export function syncBuiltinTerms(
  db: Db,
  resourcesRoot: string
): { updated: string[]; added: string[] } {
  const svc = new TermLibraryService(db)
  const dir = join(resourcesRoot, 'terms')
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return { updated: [], added: [] }
  }
  const updated: string[] = []
  const added: string[] = []
  for (const file of files) {
    let data: BuiltinTermFile
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8')) as BuiltinTermFile
    } catch {
      continue
    }
    if (!data?.game || !Array.isArray(data.terms)) continue

    const lib = svc.getLibByGame(data.game)
    if (!lib) {
      const r = db
        .prepare(
          'INSERT INTO term_libraries (game, name, version, source_url, is_builtin, updated_at) VALUES (?,?,?,?,1,?)'
        )
        .run(data.game, data.name, data.version ?? '0', null, new Date().toISOString())
      const libId = Number(r.lastInsertRowid)
      svc.bulkInsertTerms(libId, data.terms, false)
      added.push(data.game)
      continue
    }
    if (lib.is_builtin !== 1) continue
    if ((lib.version ?? '0') !== (data.version ?? '0')) {
      mergeLibraryData(db, lib.id, data)
      updated.push(data.game)
    }
  }
  if (updated.length || added.length) invalidateTermCache()
  return { updated, added }
}
