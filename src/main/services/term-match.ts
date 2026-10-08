import type { Db } from './db-wrapper'
import type { AppSettings } from '../../shared/defaults'
import type { GlossaryTerm } from './translate-prompt'
import { TermLibraryService } from './term-library'
import { getCachedTerms } from './term-cache'

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 判断原文中是否出现词条：纯字母/数字词使用边界匹配，含符号的使用子串
function appears(haystackLower: string, source: string): boolean {
  const src = source.trim().toLowerCase()
  if (!src) return false
  if (/^[a-z0-9][a-z0-9\s.'-]*$/.test(src)) {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegex(src)}(?:[^a-z0-9]|$)`)
    return re.test(haystackLower)
  }
  return haystackLower.includes(src)
}

// 从原文中命中词条，长词优先，按原文去重
export function matchTerms(
  text: string,
  terms: Array<{ source_text: string; target_text: string }>
): GlossaryTerm[] {
  const lower = text.toLowerCase()
  const sorted = [...terms].sort((a, b) => b.source_text.length - a.source_text.length)
  const hits: GlossaryTerm[] = []
  const seen = new Set<string>()
  for (const t of sorted) {
    const key = t.source_text.toLowerCase()
    if (seen.has(key)) continue
    if (appears(lower, t.source_text)) {
      seen.add(key)
      hits.push({ source_text: t.source_text, target_text: t.target_text })
    }
  }
  return hits
}

// 按当前设置解析术语库并命中原文；general（通用）或库不存在时返回空
export function resolveGlossary(db: Db, settings: AppSettings, text: string): GlossaryTerm[] {
  const game = settings.termLibrary
  if (!game || game === 'general') return []
  const svc = new TermLibraryService(db)
  const lib = svc.getLibByGame(game)
  if (!lib) return []
  return matchTerms(text, getCachedTerms(lib.id, () => svc.listTerms(lib.id)))
}
