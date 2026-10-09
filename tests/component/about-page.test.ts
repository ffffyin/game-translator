// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AboutPage from '../../src/renderer/pages/AboutPage.vue'
import { APP_VERSION } from '../../src/shared/version'
import { GITHUB_URL, QQ_NUMBER, BILIBILI_URL, DOUYIN_URL } from '../../src/shared/links'
import type { UpdateCheckResult, UpdateInfo } from '../../src/shared/update'

const DOWNLOAD_URL = 'https://example.com/game-translator-1.0.1-setup.exe'

function updateInfoOf(overrides: Partial<UpdateInfo> = {}): UpdateInfo {
  return {
    version: '1.0.1',
    notes: ['修了 OCR 偶发漏字', '新增软件更新检查'],
    publishedAt: '2026-10-09',
    downloadUrl: DOWNLOAD_URL,
    size: 138335923,
    sha256: 'a'.repeat(64),
    mandatory: false,
    ...overrides
  }
}

const LATEST: UpdateCheckResult = {
  ok: true,
  status: 'latest',
  upToDate: true,
  info: updateInfoOf({ version: APP_VERSION }),
  message: `当前已是最新版本 v${APP_VERSION}`
}

const AVAILABLE: UpdateCheckResult = {
  ok: true,
  status: 'available',
  upToDate: false,
  info: updateInfoOf(),
  message: '发现新版本 v1.0.1'
}

const FAILED: UpdateCheckResult = {
  ok: false,
  status: 'error',
  upToDate: false,
  message: '暂时无法检查更新：网络不可用或请求超时，软件可正常使用'
}

function installApi(updateResult: UpdateCheckResult = LATEST) {
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
    openExternal: vi.fn(async () => true),
    checkUpdate: vi.fn(async () => updateResult),
    openDownload: vi.fn(async () => true)
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
    expect(w.findAll('.contact-row')).toHaveLength(4)
  })

  it('展示 B 站与抖音入口，且只显示简称不显示完整网址', async () => {
    installApi()
    const w = await mountPage()
    const rows = w.findAll('.contact-row')
    expect(rows[1].text()).toContain('哔哩哔哩')
    expect(rows[1].text()).toContain('UID 12945227')
    expect(rows[2].text()).toContain('抖音')
    expect(rows[2].text()).toContain('打开主页')
    // 长网址不显示在界面上
    expect(w.text()).not.toContain('space.bilibili.com/12945227?spm')
    expect(w.text()).not.toContain('v.douyin.com/VjbsvjE5RAQ')
    // 可跳转的行才带「浏览器打开」角标
    expect(rows[0].find('.ext').exists()).toBe(true)
    expect(rows[1].find('.ext').exists()).toBe(true)
    expect(rows[2].find('.ext').exists()).toBe(true)
    expect(rows[3].find('.ext').exists()).toBe(false)
  })

  it('点击 GitHub 行用系统浏览器打开主页', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.findAll('.contact-row')[0].trigger('click')
    await vi.waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(GITHUB_URL))
  })

  it('点击 B 站 / 抖音行用系统浏览器打开对应主页', async () => {
    const api = installApi()
    const w = await mountPage()
    const rows = w.findAll('.contact-row')
    await rows[1].trigger('click')
    await vi.waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(BILIBILI_URL))
    await rows[2].trigger('click')
    await vi.waitFor(() => expect(api.openExternal).toHaveBeenCalledWith(DOUYIN_URL))
    expect(api.openExternal).toHaveBeenCalledTimes(2)
  })

  it('点击 QQ 行复制号码并给出反馈', async () => {
    installApi()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const w = await mountPage()

    await w.findAll('.contact-row')[3].trigger('click')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(QQ_NUMBER))
    expect(w.findAll('.contact-row')[3].text()).toContain('已复制')
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

  it('检查更新：已是最新时显示版本号与清单发布日期', async () => {
    const api = installApi()
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text().includes('检查软件更新'))!.trigger('click')
    expect(api.checkUpdate).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(w.text()).toContain(`当前已是最新版本 v${APP_VERSION}`))
    expect(w.text()).toContain('2026-10-09')
  })

  it('检查更新：有新版本时列出说明、体积并引导下载', async () => {
    const api = installApi(AVAILABLE)
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text().includes('检查软件更新'))!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('发现新版本 v1.0.1'))

    expect(w.text()).toContain('修了 OCR 偶发漏字')
    expect(w.text()).toContain('新增软件更新检查')
    expect(w.text()).toContain('131.9 MB')
    expect(w.text()).toContain('a'.repeat(64))

    await w.findAll('button').find((b) => b.text() === '前往下载')!.trigger('click')
    expect(api.openDownload).toHaveBeenCalledWith(DOWNLOAD_URL)
  })

  it('检查更新：失败时给出原因并提供重试', async () => {
    const api = installApi(FAILED)
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text().includes('检查软件更新'))!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('暂时无法检查更新'))
    expect(w.text()).toContain('网络不可用或请求超时')

    await w.findAll('button').find((b) => b.text() === '重试')!.trigger('click')
    await vi.waitFor(() => expect(api.checkUpdate).toHaveBeenCalledTimes(2))
  })

  it('检查更新：主进程异常时兜底，不会卡在检查中', async () => {
    const api = installApi()
    api.checkUpdate.mockRejectedValueOnce(new Error('IPC 断了'))
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text().includes('检查软件更新'))!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('检查更新失败：IPC 断了'))
    expect(w.text()).not.toContain('检查中…')
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
