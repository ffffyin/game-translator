// 术语条目缓存：一次翻译要扫描整表并逐条编译正则，按库缓存后可直接复用
// 独立成文件，避免 term-library 与 term-match 互相 import 造成循环依赖
const CACHE_TTL_MS = 60_000

export interface CachedTerm {
  source_text: string
  target_text: string
}

const cache = new Map<number, { at: number; terms: CachedTerm[] }>()

// 术语增删改/导入/内置库更新后调用；不传 libId 表示全部失效
export function invalidateTermCache(libId?: number): void {
  if (libId === undefined) cache.clear()
  else cache.delete(libId)
}

export function getCachedTerms(libId: number, load: () => CachedTerm[]): CachedTerm[] {
  const hit = cache.get(libId)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.terms
  const terms = load()
  cache.set(libId, { at: Date.now(), terms })
  return terms
}

// 仅测试使用：观察缓存是否命中
export function termCacheStats(): { size: number; libIds: number[] } {
  return { size: cache.size, libIds: [...cache.keys()] }
}
