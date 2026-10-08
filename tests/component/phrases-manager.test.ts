// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PhrasesManager from '../../src/renderer/components/PhrasesManager.vue'
import type { PhraseView } from '../../shared/phrases'

function row(id: number, patch: Partial<PhraseView> = {}): PhraseView {
  return {
    id,
    page_id: 1,
    slot: id,
    content: '话术' + id,
    accelerator: id <= 8 ? `Alt+${id}` : '',
    sort_order: id,
    enabled: 1,
    is_custom: 0,
    updated_at: '2026-10-08 10:00:00',
    ...patch
  }
}

let store: PhraseView[] = []
let seq = 100

function installApi() {
  const api = {
    phrasesList: vi.fn(async () => structuredClone(store)),
    phrasesCreate: vi.fn(async (_pageId: number, content: string) => {
      const id = ++seq
      const sort = store.length ? Math.max(...store.map((r) => r.sort_order)) + 1 : 1
      store.push(row(id, { slot: sort, content, sort_order: sort, is_custom: 1 }))
      return id
    }),
    phrasesUpdate: vi.fn(async (id: number, content: string) => {
      const t = store.find((p) => p.id === id)
      if (t) {
        t.content = content
        t.is_custom = 1
      }
    }),
    phrasesSetEnabled: vi.fn(async (id: number, enabled: boolean) => {
      const t = store.find((p) => p.id === id)
      if (t) t.enabled = enabled ? 1 : 0
    }),
    phrasesRemove: vi.fn(async (id: number) => {
      store = store.filter((p) => p.id !== id)
    }),
    phrasesMove: vi.fn(async (id: number, dir: 'up' | 'down') => {
      const sorted = [...store].sort((a, b) => a.sort_order - b.sort_order)
      const idx = sorted.findIndex((p) => p.id === id)
      const j = dir === 'up' ? idx - 1 : idx + 1
      if (j < 0 || j >= sorted.length) return
      const a = sorted[idx]
      const b = sorted[j]
      const so = a.sort_order
      a.sort_order = b.sort_order
      b.sort_order = so
    })
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

async function mountManager(pageId: number | null = 1) {
  const w = mount(PhrasesManager, { props: { pageId } })
  await vi.waitFor(() => expect(w.text()).toContain('话术1'))
  await nextTick()
  return w
}

beforeEach(() => {
  store = Array.from({ length: 8 }, (_, i) => row(i + 1))
  seq = 100
})

describe('PhrasesManager 常用语管理', () => {
  it('渲染 8 行话术与 Alt+N 快捷键', async () => {
    installApi()
    const w = await mountManager()
    expect(w.findAll('tbody tr')).toHaveLength(8)
    expect(w.text()).toContain('Alt+8')
  })

  it('启用开关点击后调用 setEnabled', async () => {
    const api = installApi()
    const w = await mountManager()
    await w.findAll('.switch')[0].trigger('click')
    expect(api.phrasesSetEnabled).toHaveBeenCalledWith(1, false)
  })

  it('新增话术：带上当前页 id，保存后出现在末尾', async () => {
    const api = installApi()
    const w = await mountManager()
    await w.find('.tools .accent').trigger('click')
    await w.find('.add-row .m-input').setValue('新话术')
    await w.find('.add-row .accent').trigger('click')
    await vi.waitFor(() => expect(api.phrasesCreate).toHaveBeenCalledWith(1, '新话术'))
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(9)
    expect(rows[rows.length - 1].text()).toContain('新话术')
  })

  it('切换话术页（pageId 变化）会重新拉取该页条目', async () => {
    const api = installApi()
    const w = await mountManager()
    expect(api.phrasesList).toHaveBeenCalledWith(1)

    // 第二页只有 3 条
    store = Array.from({ length: 3 }, (_, i) => row(i + 21, { page_id: 2, content: '第二页' + (i + 1) }))
    await w.setProps({ pageId: 2 })
    await vi.waitFor(() => expect(api.phrasesList).toHaveBeenCalledWith(2))
    await vi.waitFor(() => expect(w.findAll('tbody tr')).toHaveLength(3))
    expect(w.text()).toContain('第二页1')
  })

  it('pageId 为空时不拉取数据', async () => {
    const api = installApi()
    const w = mount(PhrasesManager, { props: { pageId: null } })
    await nextTick()
    expect(api.phrasesList).not.toHaveBeenCalled()
    expect(w.findAll('tbody tr')).toHaveLength(0)
  })

  it('编辑话术：回填后保存', async () => {
    const api = installApi()
    const w = await mountManager()
    const first = w.findAll('tbody tr')[0]
    await first.findAll('.link')[2].trigger('click') // 编辑（↑↓编辑删除）
    const input = first.find('.m-input')
    expect((input.element as HTMLInputElement).value).toBe('话术1')
    await input.setValue('改后话术')
    await first.findAll('.link')[0].trigger('click') // 保存
    await vi.waitFor(() => expect(api.phrasesUpdate).toHaveBeenCalledWith(1, '改后话术'))
  })

  it('上移/下移调用 move', async () => {
    const api = installApi()
    const w = await mountManager()
    const second = w.findAll('tbody tr')[1]
    await second.findAll('.link')[0].trigger('click') // ↑
    expect(api.phrasesMove).toHaveBeenCalledWith(2, 'up')
  })

  it('删除两步确认', async () => {
    const api = installApi()
    const w = await mountManager()
    const first = w.findAll('tbody tr')[0]
    await first.findAll('.link')[3].trigger('click') // 删除
    expect(first.text()).toContain('确认？')
    await first.findAll('.link')[0].trigger('click')
    await vi.waitFor(() => expect(api.phrasesRemove).toHaveBeenCalledWith(1))
  })
})
