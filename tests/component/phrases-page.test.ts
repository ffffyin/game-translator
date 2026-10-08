// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PhrasesPage from '../../src/renderer/pages/PhrasesPage.vue'
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/shared/defaults'
import type { PhrasePageView, PhraseView } from '../../src/shared/phrases'

function page(id: number, patch: Partial<PhrasePageView> = {}): PhrasePageView {
  return {
    id,
    name: '页' + id,
    note: '备注' + id,
    sort_order: id,
    is_active: 0,
    is_builtin: 0,
    count: 8,
    updated_at: '2026-10-09 10:00:00',
    ...patch
  }
}

function phrase(id: number, pageId: number, content: string): PhraseView {
  return {
    id,
    page_id: pageId,
    slot: id,
    content,
    accelerator: `Alt+${id}`,
    sort_order: id,
    enabled: 1,
    is_custom: 0,
    updated_at: '2026-10-09 10:00:00'
  }
}

let pages: PhrasePageView[] = []
let items: PhraseView[] = []
let seq = 100
let removeResult: { ok: boolean; error?: string } = { ok: true }

function installApi() {
  const current: AppSettings = { ...DEFAULT_SETTINGS }
  const api = {
    settingsGetAll: vi.fn(async () => ({ ...current })),
    settingsSet: vi.fn(async (k: string, v: unknown) => {
      ;(current as unknown as Record<string, unknown>)[k] = v
      return { ...current }
    }),
    phrasesListPages: vi.fn(async () => structuredClone(pages)),
    phrasesCreatePage: vi.fn(async (input: { name: string; note?: string }) => {
      const id = ++seq
      pages.push(page(id, { name: input.name, note: input.note ?? null, count: 0 }))
      return id
    }),
    phrasesUpdatePage: vi.fn(async (id: number, patch: { name?: string; note?: string }) => {
      const t = pages.find((p) => p.id === id)
      if (t) {
        if (patch.name !== undefined) t.name = patch.name
        if (patch.note !== undefined) t.note = patch.note
      }
    }),
    phrasesRemovePage: vi.fn(async (id: number) => {
      if (removeResult.ok) pages = pages.filter((p) => p.id !== id)
      return removeResult
    }),
    phrasesSetActivePage: vi.fn(async (id: number) => {
      pages.forEach((p) => (p.is_active = p.id === id ? 1 : 0))
    }),
    phrasesList: vi.fn(async (pageId: number) => items.filter((i) => i.page_id === pageId).map((i) => ({ ...i }))),
    phrasesCreate: vi.fn(async () => 1),
    phrasesUpdate: vi.fn(async () => undefined),
    phrasesSetEnabled: vi.fn(async () => undefined),
    phrasesRemove: vi.fn(async () => undefined),
    phrasesMove: vi.fn(async () => undefined)
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

async function mountPage() {
  const w = mount(PhrasesPage, { global: { plugins: [createPinia()] } })
  await vi.waitFor(() => expect(w.findAll('.page-item').length).toBe(pages.length))
  await nextTick()
  return w
}

beforeEach(() => {
  pages = [
    page(1, { name: '通用', note: '基础沟通', is_active: 1 }),
    page(2, { name: 'Dota2', note: '报点' })
  ]
  items = [phrase(1, 1, '打得好！'), phrase(2, 2, '中路不见了')]
  seq = 100
  removeResult = { ok: true }
})

describe('PhrasesPage 常用语分页', () => {
  it('列出话术页，默认选中当前页并展示其话术', async () => {
    const api = installApi()
    const w = await mountPage()
    expect(w.findAll('.page-item').map((p) => p.find('b').text())).toEqual(['通用', 'Dota2'])
    expect(w.find('.page-item.on').text()).toContain('通用')
    expect(w.findAll('.badge')).toHaveLength(1)
    expect(api.phrasesList).toHaveBeenCalledWith(1)
    // 注意：PageHeader 内部也有 .right，断言要落在表格上
    await vi.waitFor(() => expect(w.find('.p-table').text()).toContain('打得好！'))
  })

  it('点击另一个页会切换右侧内容', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.findAll('.page-item')[1].trigger('click')
    await vi.waitFor(() => expect(api.phrasesList).toHaveBeenCalledWith(2))
    await vi.waitFor(() => expect(w.find('.p-table').text()).toContain('中路不见了'))
    expect(w.find('.p-table').text()).not.toContain('打得好！')
    expect(w.find('.page-item.on').text()).toContain('Dota2')
  })

  it('设为当前页：写入并刷新「当前」徽章', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.findAll('.page-item')[1].trigger('click')
    await nextTick()
    const btn = w.findAll('.ops .m-btn').find((b) => b.text().includes('设为当前页'))!
    await btn.trigger('click')
    await vi.waitFor(() => expect(api.phrasesSetActivePage).toHaveBeenCalledWith(2))
    await vi.waitFor(() => {
      const items = w.findAll('.page-item')
      expect(items[1].find('.badge').exists()).toBe(true)
    })
  })

  it('新建话术页后自动选中新页', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.find('.new-btn').trigger('click')
    const inputs = w.findAll('.new-page .m-input')
    await inputs[0].setValue('Valorant')
    await inputs[1].setValue('技能报点')
    await w.find('.new-page .accent').trigger('click')
    await vi.waitFor(() =>
      expect(api.phrasesCreatePage).toHaveBeenCalledWith({ name: 'Valorant', note: '技能报点' })
    )
    await vi.waitFor(() => expect(w.findAll('.page-item').length).toBe(3))
    expect(w.find('.page-item.on').text()).toContain('Valorant')
  })

  it('删除话术页需要二次确认', async () => {
    const api = installApi()
    const w = await mountPage()
    const del = w.findAll('.ops .m-btn').find((b) => b.text() === '删除')!
    await del.trigger('click')
    expect(api.phrasesRemovePage).not.toHaveBeenCalled()
    const confirm = w.findAll('.ops .m-btn').find((b) => b.text() === '确认删除')!
    await confirm.trigger('click')
    await vi.waitFor(() => expect(api.phrasesRemovePage).toHaveBeenCalledWith(1))
  })

  it('删除失败（只剩一页）时提示原因且不移除', async () => {
    removeResult = { ok: false, error: '至少要保留一个常用语页' }
    installApi()
    pages = [page(1, { name: '通用', is_active: 1 })]
    const w = await mountPage()
    await w.findAll('.ops .m-btn').find((b) => b.text() === '删除')!.trigger('click')
    await w.findAll('.ops .m-btn').find((b) => b.text() === '确认删除')!.trigger('click')
    await vi.waitFor(() => expect(w.find('.msg.error').text()).toContain('至少要保留'))
    expect(w.findAll('.page-item')).toHaveLength(1)
  })

  it('保存页名与备注', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.find('.fields .name').setValue('通用话术')
    await w.findAll('.ops .m-btn').find((b) => b.text() === '保存')!.trigger('click')
    await vi.waitFor(() =>
      expect(api.phrasesUpdatePage).toHaveBeenCalledWith(1, { name: '通用话术', note: '基础沟通' })
    )
  })

  it('展示发送行为开关与当前页说明', async () => {
    installApi()
    const w = await mountPage()
    const boxes = w.findAll('.switch-row input')
    expect(boxes).toHaveLength(2)
    expect((boxes[0].element as HTMLInputElement).checked).toBe(true) // 发送前先翻译默认开
    expect((boxes[1].element as HTMLInputElement).checked).toBe(false) // 自动回车默认关
    expect(w.find('.tip').text()).toContain('Alt+1 ~ Alt+8')
    expect(w.find('.tip').text()).toContain('通用')
  })
})
