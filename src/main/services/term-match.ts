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

/**
 * 从原文中命中词条，长词优先，按原文去重。
 *
 * **双向匹配**：内置术语库是「英文 → 中文」单向的，而聊天替换翻译常常是
 * 中译英 —— 原文是中文时按 source_text 永远命中不了，术语库形同虚设。
 * 所以两侧都查，命中哪一侧就注入哪一侧的对照（中文侧命中时**翻转**成对）。
 *
 * ⚠️ 绝不能把 `A：B` 和 `B：A` 同时注入同一份 prompt，那会让模型收到
 * 自相矛盾的强制对照。这里只注入实际命中的那一侧。
 *
 * 已知可接受风险：中文走 `appears` 的 includes 子串分支，没有词边界，
 * 短中文词条（如「一血」）可能过度命中。
 */
export function matchTerms(
  text: string,
  terms: Array<{ source_text: string; target_text: string }>
): GlossaryTerm[] {
  const lower = text.toLowerCase()
  // 按「较长的一侧」排序：只按 source 排的话，中文侧比英文侧短时英文先命中并
  // 被 seen 去��，中文那侧就永远轮不到。
  const sorted = [...terms].sort(
    (a, b) =>
      Math.max(b.source_text.length, b.target_text.length) -
      Math.max(a.source_text.length, a.target_text.length)
  )
  const hits: GlossaryTerm[] = []
  // key 用「本次实际命中的那一侧」的字符串，否则两侧会互相屏蔽
  const seen = new Set<string>()
  for (const t of sorted) {
    if (appears(lower, t.source_text)) {
      const key = t.source_text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ source_text: t.source_text, target_text: t.target_text })
      continue
    }
    if (appears(lower, t.target_text)) {
      const key = t.target_text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ source_text: t.target_text, target_text: t.source_text })
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
