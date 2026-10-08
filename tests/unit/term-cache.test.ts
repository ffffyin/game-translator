import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { getCachedTerms, invalidateTermCache, termCacheStats } from '../../src/main/services/term-cache'

beforeEach(() => {
  invalidateTermCache()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('术语缓存', () => {
  it('TTL 内只加载一次', () => {
    const load = vi.fn(() => [{ source_text: 'gg', target_text: '打得好' }])
    expect(getCachedTerms(1, load)).toHaveLength(1)
    expect(getCachedTerms(1, load)).toHaveLength(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(termCacheStats().libIds).toEqual([1])
  })

  it('按 libId 分别缓存', () => {
    const load = vi.fn(() => [])
    getCachedTerms(1, load)
    getCachedTerms(2, load)
    expect(load).toHaveBeenCalledTimes(2)
    expect(termCacheStats().size).toBe(2)
  })

  it('指定 libId 失效后重新加载', () => {
    const load = vi.fn(() => [])
    getCachedTerms(1, load)
    getCachedTerms(2, load)
    invalidateTermCache(1)
    getCachedTerms(1, load)
    getCachedTerms(2, load)
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('不传 libId 时全部失效', () => {
    const load = vi.fn(() => [])
    getCachedTerms(1, load)
    getCachedTerms(2, load)
    invalidateTermCache()
    getCachedTerms(1, load)
    getCachedTerms(2, load)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('超过 TTL 后重新加载', () => {
    const load = vi.fn(() => [])
    getCachedTerms(1, load)
    vi.advanceTimersByTime(61_000)
    getCachedTerms(1, load)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
