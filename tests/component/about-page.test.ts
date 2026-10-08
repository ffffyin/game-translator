// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AboutPage from '../../src/renderer/pages/AboutPage.vue'
import { APP_VERSION } from '../../src/shared/version'
import { GITHUB_URL, QQ_NUMBER } from '../../src/shared/links'

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
    backupRestore: vi.fn(async () => undefined),
    resetToDefaults: vi.fn(async () => ({ ok: true, removed: ['translator.db'] })),
    openExternal: vi.fn(async () => true)
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

  it('展示 GitHub 地址与 QQ 号', async () => {
    installApi()
    const w = await mountPage()
    expect(w.text()).toContain('github.com/ffffyin')
    expect(w.text()).toContain('316606176')
    expect(w.findAll('.contact-row')).toHaveLength(2)
  })

  it('点击 GitHub 行用系统浏览器打开主页', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.findAll('.contact-row')[0].trigger('click')
    await vi.waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(GITHUB_URL))
  })

  it('点击 QQ 行复制号码并给出反馈', async () => {
    installApi()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = await mountPage()

    await w.findAll('.contact-row')[1].trigger('click')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(QQ_NUMBER))
    expect(w.findAll('.contact-row')[1].text()).toContain('已复制')
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

  it('恢复默认设置：两步确认后清空本机数据并提示重启', async () => {
    const api = installApi()
    const w = await mountPage()
    expect(api.resetToDefaults).not.toHaveBeenCalled()

    await w.findAll('button').find((b) => b.text() === '恢复默认设置')!.trigger('click')
    await w.findAll('button').find((b) => b.text() === '取消')!.trigger('click')
    expect(api.resetToDefaults).not.toHaveBeenCalled()

    await w.findAll('button').find((b) => b.text() === '恢复默认设置')!.trigger('click')
    await w.findAll('button').find((b) => b.text() === '确认清空并重启')!.trigger('click')
    await vi.waitFor(() => expect(api.resetToDefaults).toHaveBeenCalledTimes(1))
    expect(w.text()).toContain('已清空本机数据')
  })
})
