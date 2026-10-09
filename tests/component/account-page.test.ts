// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AccountPage from '../../src/renderer/pages/AccountPage.vue'
import type { CloudStatus, CloudSummary } from '../../src/shared/cloud'

const SUMMARY: CloudSummary = { termLibs: 2, terms: 20, phrasePages: 3, phrases: 24 }

function signedOut(): CloudStatus {
  return {
    available: true,
    signedIn: false,
    userId: null,
    email: null,
    phone: null,
    remoteUpdatedAt: null,
    remoteSummary: null,
    online: true,
    message: '未登录'
  }
}

function signedIn(over: Partial<CloudStatus> = {}): CloudStatus {
  return {
    available: true,
    signedIn: true,
    userId: 'uid-1',
    email: 'me@example.com',
    phone: null,
    remoteUpdatedAt: '2026-10-09T08:00:00.000Z',
    remoteSummary: SUMMARY,
    online: true,
    message: '已登录',
    ...over
  }
}

function installApi(status: CloudStatus) {
  const api = {
    cloudStatus: vi.fn(async () => status),
    cloudLocalSummary: vi.fn(async () => SUMMARY),
    cloudSendOtp: vi.fn(async () => ({
      ok: true,
      message: '验证码已发送',
      verificationId: 'vid-1',
      isExistingUser: false
    })),
    cloudVerifyOtp: vi.fn(async () => ({ ok: true, message: '登录成功', status: signedIn() })),
    cloudSignOut: vi.fn(async () => ({ ok: true, message: '已退出登录' })),
    cloudPush: vi.fn(async () => ({ ok: true, message: '已保存到云端', summary: SUMMARY })),
    cloudPull: vi.fn(async () => ({ ok: true, message: '已恢复', summary: SUMMARY })),
    cloudRemoveRemote: vi.fn(async () => ({ ok: true, message: '已删除云端配置' }))
  }
  ;(window as unknown as { api: typeof api }).api = api
  return api
}

async function mountPage() {
  const w = mount(AccountPage)
  await vi.waitFor(() => expect(w.text()).not.toContain('正在读取账号状态'))
  return w
}

beforeEach(() => {
  vi.useRealTimers()
})

describe('AccountPage 账号与云同步', () => {
  it('未登录时展示邮箱验证码登录入口，并明确说明不设密码', async () => {
    installApi(signedOut())
    const w = await mountPage()
    expect(w.text()).toContain('邮箱验证码登录')
    expect(w.text()).toContain('全程不设密码')
    expect(w.find('input[placeholder="you@example.com"]').exists()).toBe(true)
  })

  it('未登录时不出现任何云端操作按钮', async () => {
    installApi(signedOut())
    const w = await mountPage()
    const texts = w.findAll('button').map((b) => b.text())
    expect(texts.join('|')).not.toContain('保存到云端')
    expect(texts.join('|')).not.toContain('退出登录')
  })

  it('点获取验证码走 cloudSendOtp，成功后露出验证码输入框', async () => {
    const api = installApi(signedOut())
    const w = await mountPage()
    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.findAll('button')[0].trigger('click')
    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalledWith('me@example.com'))
    expect(w.text()).toContain('验证码已发送')
  })

  it('邮箱格式不合法时直接本地拦下，不发请求', async () => {
    const api = installApi(signedOut())
    const w = await mountPage()
    await w.find('input[placeholder="you@example.com"]').setValue('not-an-email')
    await w.findAll('button')[0].trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('请输入正确的邮箱地址'))
    expect(api.cloudSendOtp).not.toHaveBeenCalled()
  })

  it('已登录时展示账号、云端/本机概况与四个操作', async () => {
    installApi(signedIn())
    const w = await mountPage()
    expect(w.text()).toContain('me@example.com')
    expect(w.text()).toContain('uid-1')
    expect(w.text()).toContain('术语库 2 个')
    const texts = w.findAll('button').map((b) => b.text())
    expect(texts).toContain('保存到云端')
    expect(texts).toContain('从云端恢复')
    expect(texts).toContain('退出登录')
    expect(texts).toContain('删除云端配置')
  })

  it('从云端恢复要点两次：第一次只是提示会覆盖本机', async () => {
    const api = installApi(signedIn())
    const w = await mountPage()
    const pullBtn = w.findAll('button').find((b) => b.text() === '从云端恢复')!
    await pullBtn.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('再用云端覆盖本机'))
    expect(api.cloudPull).not.toHaveBeenCalled()

    // 二次确认后按钮文案变了，用新的按钮再点一次
    const armed = w.findAll('button').find((b) => b.text().includes('再点一次确认覆盖'))!
    await armed.trigger('click')
    await vi.waitFor(() => expect(api.cloudPull).toHaveBeenCalled())
  })

  it('删除云端配置同样需要二次确认', async () => {
    const api = installApi(signedIn())
    const w = await mountPage()
    await w.findAll('button').find((b) => b.text() === '删除云端配置')!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('再点一次确认删除'))
    expect(api.cloudRemoveRemote).not.toHaveBeenCalled()
    await w.findAll('button').find((b) => b.text().includes('再点一次确认删除'))!.trigger('click')
    await vi.waitFor(() => expect(api.cloudRemoveRemote).toHaveBeenCalled())
  })

  it('离线时显示离线标记，账号信息仍来自缓存', async () => {
    installApi(signedIn({ online: false, message: '网络不可用，暂时无法读取云端配置' }))
    const w = await mountPage()
    expect(w.text()).toContain('离线')
    expect(w.text()).toContain('me@example.com')
  })

  it('页内明确写出 API Key 不同步，避免用户误以为 Key 会上云', async () => {
    installApi(signedIn())
    const w = await mountPage()
    expect(w.text()).toContain('不同步')
    expect(w.text()).toContain('API Key')
    expect(w.text()).toContain('绝不会上传')
  })
})
