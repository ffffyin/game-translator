// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import TermsManager from '../../src/renderer/components/TermsManager.vue'
import type { LibView, TermView } from '../../src/shared/terms'

function lib(id: number, patch: Partial<LibView> = {}): LibView {
  return {
    id,
    game: id === 1 ? 'dota2' : id === 2 ? 'cs2' : `custom_${id}`,
    name: id === 1 ? 'Dota 2' : id === 2 ? 'CS2' : '我的库',
    version: '2026.10.08',
    source_url: null,
    is_builtin: id <= 2 ? 1 : 0,
    updated_at: '2026-10-08 10:00:00',
    ...patch
  }
}

function term(id: number, libId: number): TermView {
  return {
    id,
    lib_id: libId,
    source_text: 'src' + id,
    target_text: '译' + id,
    tag: id % 2 ? '战术' : null,
    is_custom: 0,
    updated_at: '2026-10-08 10:00:00'
  }
}

let libsStore: LibView[] = []
let termsStore: Record<number, TermView[]> = {}
let seq = 1000

function installApi() {
  const api = {
    termsListLibs: vi.fn(async () => structuredClone(libsStore)),
    termsListTerms: vi.fn(async (id: number, search?: string) => {
      let list = termsStore[id] ?? []
      if (search) list = list.filter((t) => t.source_text.includes(search))
      return structuredClone(list)
    }),
    termsCreateLib: vi.fn(async (input: { name: string }) => {
      const id = ++seq
      libsStore.push(lib(id, { name: input.name }))
      termsStore[id] = []
      return id
    }),
    termsDeleteLib: vi.fn(async (id: number) => {
      libsStore = libsStore.filter((l) => l.id !== id)
      delete termsStore[id]
    }),
    termsCreateTerm: vi.fn(async (id: number, input: Partial<TermView>) => {
      const t = term(++seq, id)
      t.source_text = input.source_text ?? t.source_text
      t.target_text = input.target_text ?? t.target_text
      t.is_custom = 1
      ;(termsStore[id] ??= []).push(t)
      return t.id
    }),
    termsUpdateTerm: vi.fn(async (tid: number, input: Partial<TermView>) => {
      for (const list of Object.values(termsStore)) {
        const t = list.find((x) => x.id === tid)
        if (t) {
          t.source_text = input.source_text ?? t.source_text
          t.target_text = input.target_text ?? t.target_text
          t.is_custom = 1
        }
      }
    }),
    termsDeleteTerm: vi.fn(async (tid: number) => {
      for (const id of Object.keys(termsStore)) {
        termsStore[Number(id)] = (termsStore[Number(id)] ?? []).filter((t) => t.id !== tid)
      }
    }),
    settingsGetAll: vi.fn(async () => ({ termUpdateUrl: '' })),
    settingsSet: vi.fn(async () => undefined)
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

async function mountManager() {
  const w = mount(TermsManager)
  await vi.waitFor(() => expect(w.text()).toContain('Dota 2'))
  await nextTick()
  return w
}

beforeEach(() => {
  libsStore = [lib(1), lib(2)]
  termsStore = {
    1: [term(11, 1), term(12, 1)],
    2: [term(21, 2)]
  }
  seq = 1000
})

describe('TermsManager 术语库管理', () => {
  it('渲染库标签与首个库的词条表格', async () => {
    installApi()
    const w = await mountManager()
    expect(w.text()).toContain('src11')
    expect(w.text()).toContain('译11')
    expect(w.text()).toContain('版本 2026.10.08')
  })

  it('切换库加载对应词条', async () => {
    installApi()
    const w = await mountManager()
    await w.findAll('.chip')[1].trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('src21'))
    expect(w.text()).not.toContain('src11')
  })

  it('搜索框按输入过滤词条', async () => {
    const api = installApi()
    const w = await mountManager()
    await w.find('.search').setValue('src11')
    await vi.waitFor(() =>
      expect(api.termsListTerms).toHaveBeenCalledWith(1, expect.stringContaining('src11'))
    )
  })

  it('添加词条：表单校验后调用创建并刷新', async () => {
    const api = installApi()
    const w = await mountManager()
    await w.find('.tools .accent').trigger('click')
    expect(w.text()).toContain('添加词条')

    const inputs = w.findAll('.form-grid .m-input')
    await inputs[0].setValue('gank')
    await inputs[1].setValue('抓人')
    await w.find('.form-actions .accent').trigger('click')

    await vi.waitFor(() =>
      expect(api.termsCreateTerm).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ source_text: 'gank', target_text: '抓人' })
      )
    )
  })

  it('原文或译文为空时显示错误且不保存', async () => {
    const api = installApi()
    const w = await mountManager()
    await w.find('.tools .accent').trigger('click')
    await w.find('.form-actions .accent').trigger('click')
    expect(w.text()).toContain('原文和译文都不能为空')
    expect(api.termsCreateTerm).not.toHaveBeenCalled()
  })

  it('编辑词条：回填后更新', async () => {
    const api = installApi()
    const w = await mountManager()
    const rows = w.findAll('tbody tr')
    await rows[0].findAll('.link')[0].trigger('click') // 编辑
    expect(w.text()).toContain('编辑词条')
    const inputs = w.findAll('.form-grid .m-input')
    expect((inputs[0].element as HTMLInputElement).value).toBe('src11')
    await inputs[1].setValue('新译文')
    await w.find('.form-actions .accent').trigger('click')
    await vi.waitFor(() =>
      expect(api.termsUpdateTerm).toHaveBeenCalledWith(
        11,
        expect.objectContaining({ target_text: '新译文' })
      )
    )
  })

  it('删除词条两步确认', async () => {
    const api = installApi()
    const w = await mountManager()
    const rows = w.findAll('tbody tr')
    await rows[0].findAll('.link')[1].trigger('click') // 删除
    expect(w.text()).toContain('确认？')
    await rows[0].findAll('.link')[0].trigger('click') // 确认删除
    await vi.waitFor(() => expect(api.termsDeleteTerm).toHaveBeenCalledWith(11))
  })

  it('新建自定义库后出现在标签中', async () => {
    const api = installApi()
    const w = await mountManager()
    await w.find('.chip.ghost').trigger('click')
    await w.find('.new-lib .m-input').setValue('瓦罗兰特')
    await w.find('.new-lib .accent').trigger('click')
    await vi.waitFor(() => expect(api.termsCreateLib).toHaveBeenCalled())
    expect(w.text()).toContain('瓦罗兰特')
  })

  it('自定义库可两步删除，内置库不显示删除入口', async () => {
    const api = installApi()
    libsStore.push(lib(3))
    termsStore[3] = [term(31, 3)]
    const w = await mountManager()
    // 内置库无删除入口
    expect(w.find('.lib-meta').text()).not.toContain('删除该库')

    const chips = w.findAll('.chip')
    const customChip = chips.find((c) => c.text().includes('我的库'))!
    await customChip.trigger('click')
    await vi.waitFor(() => expect(w.find('.lib-meta').text()).toContain('删除该库')
    )
    await w.find('.lib-meta .link.danger').trigger('click')
    await w.findAll('.lib-meta .link.danger')[0].trigger('click')
    await vi.waitFor(() => expect(api.termsDeleteLib).toHaveBeenCalledWith(3))
  })
})
