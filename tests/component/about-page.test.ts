// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AboutPage from '../../src/renderer/pages/AboutPage.vue'
import { APP_VERSION } from '../../src/shared/version'

function installApi() {
  const api = {
    getDataDir: vi.fn(async () => 'C:\\Users\\t\\AppData\\Roaming\\GameTranslator'),
    openDataDir: vi.fn(async () => true),
    termsListLibs: vi.fn(async () => [
      { id: 1, game: 'dota2', name: 'Dota2', version: '2026.10.08', is_builtin: 1, term_count: 71 },
      { id: 2, game: 'lol', name: 'LOL', version: '2026.10.08', is_builtin: 1, term_count: 67 }
    ]),
    backupList: vi.fn(async () => [
      { name: 'translator-2026-10-08.db', mtime: new Date().toISOString(), size: 20480 }
    ]),
    backupCreate: vi.fn(async () => [
      { name: 'translator-manual-x.db', mtime: new Date().toISOString(), size: 20480 }
    ]),
    backupRestore: vi.fn(async () => undefined)
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

async function mountPage() {
  const w = mount(AboutPage)
  await vi.waitFor(() => expect(w.text()).toContain('C:\\Users'))
  return w
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('AboutPage 关于页', () => {
  it('显示作者 fygod 与版本号', async () => {
    installApi()
    const w = await mountPage()
    expect(w.text()).toContain('fygod')
    expect(w.text()).toContain(APP_VERSION)
  })

  it('显示数据目录且可点击打开', async () => {
    const api = installApi()
    const w = await mountPage()
    const btns = w.findAll('button')
    await btns.find((b) => b.text().includes('打开数据目录'))!.trigger('click')
    expect(api.openDataDir).toHaveBeenCalled()
  })

  it('列出术语库版本', async () => {
    installApi()
    const w = await mountPage()
    expect(w.text()).toContain('Dota2')
    expect(w.text()).toContain('71 条')
  })

  it('检查更新：给出本地版本说明', async () => {
    vi.useFakeTimers()
    installApi()
    const w = mount(AboutPage)
    await vi.waitFor(() => expect(w.text()).toContain('检查软件更新'))
    await w.findAll('button').find((b) => b.text().includes('检查软件更新'))!.trigger('click')
    await vi.advanceTimersByTime(700)
    expect(w.text()).toContain('已是最新版本')
    vi.useRealTimers()
  })

  it('包含免责声明', async () => {
    installApi()
    const w = await mountPage()
    expect(w.text()).toContain('免责声明')
  })

  it('备份与恢复：列出备份，两步确认还原，立即备份触发创建', async () => {
    const api = installApi()
    const w = await mountPage()
    expect(w.text()).toContain('translator-2026-10-08.db')

    await w.findAll('button').find((b) => b.text() === '还原')!.trigger('click')
    await w.findAll('button').find((b) => b.text() === '确认还原')!.trigger('click')
    expect(api.backupRestore).toHaveBeenCalledWith('translator-2026-10-08.db')

    await w.findAll('button').find((b) => b.text().includes('立即备份'))!.trigger('click')
    expect(api.backupCreate).toHaveBeenCalled()
  })
})
