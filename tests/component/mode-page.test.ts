// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ModePage from '../../src/renderer/pages/ModePage.vue'
import { DEFAULT_SETTINGS, type AppSettings } from '../../src/shared/defaults'
import { useSettingsStore } from '../../src/renderer/stores/settings'

let api: ReturnType<typeof installApi>

function installApi(initial: Partial<AppSettings> = {}) {
  const current: AppSettings = { ...DEFAULT_SETTINGS, ...initial }
  const mock = {
    settingsGetAll: vi.fn(async () => ({ ...current })),
    settingsSet: vi.fn(async (key: string, value: unknown) => {
      ;(current as unknown as Record<string, unknown>)[key] = value
      return { ...current }
    }),
    phrasesList: vi.fn(async () => []),
    phrasesCreate: vi.fn(async () => 1),
    phrasesUpdate: vi.fn(async () => undefined),
    phrasesRemove: vi.fn(async () => undefined),
    phrasesMove: vi.fn(async () => undefined),
    phrasesSetEnabled: vi.fn(async () => undefined),
    phrasesReset: vi.fn(async () => undefined),
    termsListLibs: vi.fn(async () => []),
    termsListTerms: vi.fn(async () => []),
    termsCreateLib: vi.fn(async () => 1),
    termsRenameLib: vi.fn(async () => undefined),
    termsRemoveLib: vi.fn(async () => undefined),
    termsCreate: vi.fn(async () => 1),
    termsUpdate: vi.fn(async () => undefined),
    termsRemove: vi.fn(async () => undefined),
    termsImport: vi.fn(async () => 0),
    termsExport: vi.fn(async () => '')
  }
  ;(window as unknown as { api: typeof mock }).api = mock
  return mock
}

function mountPage(style = 'toxic') {
  const pinia = createPinia()
  setActivePinia(pinia)
  api = installApi({ translationStyle: style })
  const w = mount(ModePage, { global: { plugins: [pinia] } })
  const s = useSettingsStore()
  s.settings.translationStyle = style
  return w
}

beforeEach(() => {
  installApi()
})

describe('ModePage 嘴臭火力档位', () => {
  it('非嘴臭风格时不展示火力档位', async () => {
    const w = mountPage('daily')
    await nextTick()
    expect(w.find('.toxic-levels').exists()).toBe(false)
  })

  it('切到嘴臭风格后展示三档火力，默认标准嘴臭', async () => {
    const w = mountPage()
    await nextTick()
    expect(w.find('.toxic-levels').exists()).toBe(true)
    const opts = w.findAll('.lvl-opt')
    expect(opts).toHaveLength(3)
    expect(opts.map((o) => o.find('b').text())).toEqual(['阴阳怪气', '标准嘴臭', '火力全开'])
    expect(opts[1].classes()).toContain('on')
  })

  it('点击火力全开会写入 toxicLevel 并高亮', async () => {
    const w = mountPage()
    const s = useSettingsStore()
    await nextTick()
    await w.findAll('.lvl-opt')[2].trigger('click')
    await nextTick()
    expect(api.settingsSet).toHaveBeenCalledWith('toxicLevel', 'nuclear')
    expect(s.settings.toxicLevel).toBe('nuclear')
    expect(w.findAll('.lvl-opt')[2].classes()).toContain('on')
    expect(w.findAll('.lvl-opt')[1].classes()).not.toContain('on')
  })

  it('识别引擎可在设置页切换（本地 OCR / AI 视觉）', async () => {
    const w = mountPage()
    await nextTick()
    const cards = w.findAll('.m-card')
    const engineCard = cards.find((c) => c.text().includes('截图识别引擎'))!
    const opts = engineCard.findAll('.style-opt')
    expect(opts.map((o) => o.find('b').text())).toEqual(['本地 OCR', 'AI 视觉'])
    expect(opts[0].classes()).toContain('on')
    await opts[1].trigger('click')
    await nextTick()
    expect(api.settingsSet).toHaveBeenCalledWith('ocrEngine', 'vision')
    expect(engineCard.findAll('.style-opt')[1].classes()).toContain('on')
  })

  it('提示语说明不会凭空编造', async () => {
    const w = mountPage()
    await nextTick()
    expect(w.find('.tip').text()).toContain('不会凭空编造')
  })
})
