// @vitest-environment happy-dom
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import AccountPage from '../../src/renderer/pages/AccountPage.vue'
import AuthPage from '../../src/renderer/pages/AuthPage.vue'
import AccountLoginForm from '../../src/renderer/components/account/AccountLoginForm.vue'
import AccountRegisterForm from '../../src/renderer/components/account/AccountRegisterForm.vue'
import AccountResetForm from '../../src/renderer/components/account/AccountResetForm.vue'
import { useAuthStore } from '../../src/renderer/stores/auth'
import {
  authFail,
  authOk,
  installAccountApi,
  otpOk,
  signedIn,
  signedOut
} from './helpers/account-api'

const mounted: VueWrapper[] = []

function track(w: VueWrapper): VueWrapper {
  mounted.push(w)
  return w
}

function mountVm(component: unknown, router: unknown = null) {
  const pinia = createPinia()
  // setActivePinia 让用例自己也能直接读同一份 store（断言登录态用）
  setActivePinia(pinia)
  const plugins = [pinia, ...(router ? [router as never] : [])]
  return track(
    mount(component as never, {
      global: { plugins }
    })
  )
}

async function submit(w: VueWrapper, selector = 'form.login'): Promise<void> {
  await w.find(selector).trigger('submit')
  await nextTick()
}

/**
 * 等按钮真的出现在 DOM 里。
 *
 * 不能只靠 w.text()：同步范围说明卡的说明文字里也写了「从云端恢复」，
 * 用它做等待条件会在面板尚未渲染时就通过。
 */
async function waitButton(w: VueWrapper, label: string): Promise<void> {
  await vi.waitFor(() => expect(w.findAll('button').map((b) => b.text())).toContain(label))
}

beforeEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  // 注册/重置表单的倒计时用的是真实 setInterval，不卸载会漏到下一条用例
  while (mounted.length > 0) mounted.pop()?.unmount()
})

describe('AccountPage 账号与云同步', () => {
  it('未登录时展示「邮箱 + 密码」登录表单，而不是验证码表单', async () => {
    installAccountApi(signedOut())
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.text()).not.toContain('正在读取账号状态'))

    expect(w.find('input[placeholder="you@example.com"]').exists()).toBe(true)
    expect(w.find('input#login-password').exists()).toBe(true)
    expect(w.find('input#login-password').attributes('type')).toBe('password')
    expect(w.text()).not.toContain('获取验证码')
    expect(w.findAll('button').map((b) => b.text())).toContain('登录')
  })

  it('邮箱格式不合法时本地拦下，提示「请输入正确的邮箱地址」且不发请求', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.find('form.login').exists()).toBe(true))

    await w.find('input[placeholder="you@example.com"]').setValue('not-an-email')
    await submit(w)
    await vi.waitFor(() => expect(w.text()).toContain('请输入正确的邮箱地址'))
    expect(api.cloudSignIn).not.toHaveBeenCalled()
  })

  it('密码长度越界被拦：短于 6 位 / 长于 60 位都不许提交', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.find('form.login').exists()).toBe(true))

    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')

    await w.find('input#login-password').setValue('12345')
    await submit(w)
    await vi.waitFor(() => expect(w.text()).toContain('密码至少 6 位'))
    expect(api.cloudSignIn).not.toHaveBeenCalled()

    // 前端上限必须 ≤60：61 位被拦 —— 上限写成 64 会把后端英文正则原文放出来
    await w.find('input#login-password').setValue('x'.repeat(61))
    await submit(w)
    await vi.waitFor(() => expect(w.text()).toContain('密码最多 60 位'))
    expect(api.cloudSignIn).not.toHaveBeenCalled()

    // 60 位应当放行（走到 IPC），说明前端挡的正是合法边界而不是乱挡
    await w.find('input#login-password').setValue('x'.repeat(60))
    await submit(w)
    await vi.waitFor(() => expect(api.cloudSignIn).toHaveBeenCalledTimes(1))
  })

  it('登录失败把英文原文兜底成中文提示，绝不上屏', async () => {
    installAccountApi(signedOut(), {
      cloudSignIn: vi.fn(async () =>
        authFail('the session is invalid, expired or issued for another client')
      )
    })
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.find('form.login').exists()).toBe(true))

    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('input#login-password').setValue('secret123')
    await submit(w)

    await vi.waitFor(() => expect(w.text()).toContain('操作失败，请稍后重试'))
    expect(w.text()).not.toContain('session')
    expect(w.text()).not.toContain('expired')
  })

  it('登录失败但主进程已给中文时，原样展示', async () => {
    installAccountApi(
      signedOut(),
      {
        cloudSignIn: vi.fn(async () => authFail('邮箱或密码不正确'))
      }
    )
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.find('form.login').exists()).toBe(true))

    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('input#login-password').setValue('secret123')
    await submit(w)

    await vi.waitFor(() => expect(w.text()).toContain('邮箱或密码不正确'))
  })

  it('已登录时展示账号面板：昵称、掩码邮箱与四个云端操作', async () => {
    installAccountApi(signedIn())
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.text()).not.toContain('正在读取账号状态'))

    expect(w.text()).toContain('阿强')
    expect(w.text()).toContain('m***@example.com')
    // 完整邮箱不许出现在界面上
    expect(w.text()).not.toContain('me@example.com')

    const texts = w.findAll('button').map((b) => b.text())
    expect(texts).toContain('保存到云端')
    expect(texts).toContain('从云端恢复')
    expect(texts).toContain('删除云端配置')
    expect(texts).toContain('退出登录')
    expect(texts).toContain('修改密码')
  })

  it('离线可用：仍显示已登录账号，云端操作提示网络不可用而不是把人踢下线', async () => {
    const api = installAccountApi(
      signedIn({ online: false, message: '网络不可用，暂时无法读取云端配置' })
    )
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.text()).toContain('离线'))

    expect(w.text()).toContain('m***@example.com')
    await waitButton(w, '保存到云端')

    await w.findAll('button').find((b) => b.text() === '保存到云端')!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('网络不可用，暂时无法使用云端同步'))
    expect(api.cloudPush).not.toHaveBeenCalled()
  })

  it('退出登录需二次确认：第一次只是提示', async () => {
    const api = installAccountApi(signedIn())
    const w = mountVm(AccountPage)
    await waitButton(w, '退出登录')

    await w.findAll('button').find((b) => b.text() === '退出登录')!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('再点一次确认退出'))
    expect(api.cloudSignOut).not.toHaveBeenCalled()

    await w.findAll('button').find((b) => b.text() === '再点一次确认退出')!.trigger('click')
    await vi.waitFor(() => expect(api.cloudSignOut).toHaveBeenCalled())
  })

  it('修改密码入口：校验通过才调用 cloudChangePassword', async () => {
    const api = installAccountApi(signedIn())
    const w = mountVm(AccountPage)
    await waitButton(w, '修改密码')

    await w.findAll('button').find((b) => b.text() === '修改密码')!.trigger('click')
    await vi.waitFor(() => expect(w.find('form.chg').exists()).toBe(true))

    await w.find('input#change-old-password').setValue('old12345')
    await w.find('input#change-new-password').setValue('new123456')
    await w.find('input#change-new-password-confirm').setValue('new1234')
    await submit(w, 'form.chg')
    await vi.waitFor(() => expect(w.text()).toContain('两次输入的新密码不一致'))
    expect(api.cloudChangePassword).not.toHaveBeenCalled()

    await w.find('input#change-new-password-confirm').setValue('new123456')
    await submit(w, 'form.chg')
    await vi.waitFor(() => expect(api.cloudChangePassword).toHaveBeenCalledWith({
      oldPassword: 'old12345',
      newPassword: 'new123456'
    }))
  })

  it('同步范围说明卡保留原有「不同步」条目，并新增 API 配置一行', async () => {
    installAccountApi(signedIn())
    const w = mountVm(AccountPage)
    await vi.waitFor(() => expect(w.find('.note-card').exists()).toBe(true))

    const note = w.find('.note-card').text()
    expect(note).toContain('不同步')
    expect(note).toContain('模型地址与 API Key')
    expect(note).toContain('绝不会上传')
    expect(note).toContain('API 配置')
    expect(note).toContain('默认不同步；开启后同步（含密钥明文）')
  })

  it('从云端恢复与删除云端配置都要点两次', async () => {
    const api = installAccountApi(signedIn())
    const w = mountVm(AccountPage)
    await waitButton(w, '从云端恢复')

    await w.findAll('button').find((b) => b.text() === '从云端恢复')!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('再用云端覆盖本机'))
    expect(api.cloudPull).not.toHaveBeenCalled()
    await w.findAll('button').find((b) => b.text().includes('再点一次确认覆盖'))!.trigger('click')
    await vi.waitFor(() => expect(api.cloudPull).toHaveBeenCalled())
    // 等这一轮云端操作完全收尾（working=false），否则下一次点击会被忙碌态挡掉
    await vi.waitFor(() => expect(w.find('.msg.ok').text()).toContain('已从云端恢复'))
    await vi.waitFor(() =>
      expect(
        w.findAll('button').find((b) => b.text() === '保存到云端')!.attributes('disabled')
      ).toBeUndefined()
    )

    await w.findAll('button').find((b) => b.text() === '删除云端配置')!.trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('再点一次确认删除'))
    expect(api.cloudRemoveRemote).not.toHaveBeenCalled()
    await w.findAll('button').find((b) => b.text().includes('再点一次确认删除'))!.trigger('click')
    await vi.waitFor(() => expect(api.cloudRemoveRemote).toHaveBeenCalled())
  })
})

describe('AccountLoginForm 登录表单', () => {
  it('勾选「记住邮箱」登录成功后写入本机设置', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountLoginForm)

    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('input#login-password').setValue('secret123')
    await submit(w)

    await vi.waitFor(() =>
      expect(api.settingsSet).toHaveBeenCalledWith('cloudAccountEmail', 'me@example.com')
    )
    expect(api.settingsSet).toHaveBeenCalledWith('cloudRememberAccount', 1)
  })

  it('眼睛按钮可以在密文与明文之间切换', async () => {
    installAccountApi(signedOut())
    const w = mountVm(AccountLoginForm)
    expect(w.find('input#login-password').attributes('type')).toBe('password')
    await w.find('.eye').trigger('click')
    expect(w.find('input#login-password').attributes('type')).toBe('text')
  })
})

describe('AccountRegisterForm 注册表单', () => {
  it('获取验证码后进入倒计时，期间重复点击不再发码（限流 1 条/分钟）', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountRegisterForm)

    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')

    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(w.find('.send-btn').text()).toContain('秒后重发'))
    expect(w.find('.send-btn').attributes('disabled')).toBeDefined()

    // 二次点击被挡：面上按钮 disabled，处理器里也再挡一道
    await w.find('.send-btn').trigger('click')
    await nextTick()
    expect(api.cloudSendOtp).toHaveBeenCalledTimes(1)
  })

  it('邮箱不合法时不发码，也不启动倒计时', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountRegisterForm)

    await w.find('input[placeholder="you@example.com"]').setValue('bad-mail')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('请输入正确的邮箱地址'))
    expect(api.cloudSendOtp).not.toHaveBeenCalled()
    expect(w.find('.send-btn').text()).toBe('获取验证码')
  })

  it('该邮箱已注册时提示回登录页', async () => {
    installAccountApi(signedOut(), {
      cloudSendOtp: vi.fn(async () => otpOk({ isExistingUser: true }))
    })
    const w = mountVm(AccountRegisterForm)

    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(w.text()).toContain('该邮箱已注册'))
  })

  it('未发码直接提交会被拦下', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountRegisterForm)

    await w.find('input[placeholder="仅用于展示，不参与登录"]').setValue('阿强')
    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('input.otp').setValue('123456')
    await w.find('input#register-password').setValue('secret123')
    await w.find('input#register-password-confirm').setValue('secret123')
    await submit(w, 'form.reg')

    await vi.waitFor(() => expect(w.text()).toContain('请先获取邮箱验证码'))
    expect(api.cloudSignUp).not.toHaveBeenCalled()
  })

  it('两次密码不一致时拦下，不发注册请求', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountRegisterForm)

    await w.find('input[placeholder="仅用于展示，不参与登录"]').setValue('阿强')
    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalled())

    await w.find('input.otp').setValue('123456')
    await w.find('input#register-password').setValue('secret123')
    await w.find('input#register-password-confirm').setValue('secret124')
    await submit(w, 'form.reg')

    await vi.waitFor(() => expect(w.text()).toContain('两次输入的密码不一致'))
    expect(api.cloudSignUp).not.toHaveBeenCalled()
  })

  it('昵称 + 邮箱 + 验证码 + 密码齐备时调用 cloudSignUp', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountRegisterForm)

    await w.find('input[placeholder="仅用于展示，不参与登录"]').setValue('阿强')
    await w.find('input[placeholder="you@example.com"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalled())

    await w.find('input.otp').setValue('123456')
    await w.find('input#register-password').setValue('secret123')
    await w.find('input#register-password-confirm').setValue('secret123')
    await submit(w, 'form.reg')

    await vi.waitFor(() => expect(api.cloudSignUp).toHaveBeenCalled())
    expect(api.cloudSignUp).toHaveBeenCalledWith({
      nickname: '阿强',
      email: 'me@example.com',
      password: 'secret123',
      verificationId: 'vid-1',
      code: '123456'
    })
  })
})

describe('AccountResetForm 重置密码表单', () => {
  it('发码走 reset 通道，成功后进入倒计时', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountResetForm)

    await w.find('input[placeholder="注册时使用的邮箱"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')

    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalledWith('me@example.com', 'reset'))
    await vi.waitFor(() => expect(w.find('.send-btn').text()).toContain('秒后重发'))
  })

  it('校验通过后调用 cloudResetPassword', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountResetForm)

    await w.find('input[placeholder="注册时使用的邮箱"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalled())

    await w.find('input.otp').setValue('123456')
    await w.find('input#reset-password').setValue('new123456')
    await w.find('input#reset-password-confirm').setValue('new123456')
    await submit(w, 'form.reset')

    await vi.waitFor(() => expect(api.cloudResetPassword).toHaveBeenCalledWith({
      email: 'me@example.com',
      verificationId: 'vid-1',
      code: '123456',
      newPassword: 'new123456'
    }))
  })

  it('两次输入的新密码不一致时不提交', async () => {
    const api = installAccountApi(signedOut())
    const w = mountVm(AccountResetForm)

    await w.find('input[placeholder="注册时使用的邮箱"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(api.cloudSendOtp).toHaveBeenCalled())

    await w.find('input.otp').setValue('123456')
    await w.find('input#reset-password').setValue('new123456')
    await w.find('input#reset-password-confirm').setValue('new1234')
    await submit(w, 'form.reset')

    await vi.waitFor(() => expect(w.text()).toContain('两次输入的密码不一致'))
    expect(api.cloudResetPassword).not.toHaveBeenCalled()
  })
})

describe('AccountResetForm 重置成功后的两条分支', () => {
  async function fillAndSubmit(w: VueWrapper): Promise<void> {
    await w.find('input[placeholder="注册时使用的邮箱"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(w.find('.send-btn').text()).toContain('秒后重发'))
    await w.find('input.otp').setValue('123456')
    await w.find('input#reset-password').setValue('new123456')
    await w.find('input#reset-password-confirm').setValue('new123456')
    await submit(w, 'form.reset')
  }

  it('重置成功且主进程已自动登录：写入登录态，不再让用户重输一遍', async () => {
    installAccountApi(signedOut(), {
      cloudResetPassword: vi.fn(async () => authOk('密码已重置', signedIn()))
    })
    const w = mountVm(AccountResetForm)
    await fillAndSubmit(w)

    await vi.waitFor(() => expect(useAuthStore().signedIn).toBe(true))
    expect(useAuthStore().email).toBe('me@example.com')
    expect(w.emitted('signed-in')).toBeTruthy()
    expect(w.emitted('done')).toBeFalsy()
    expect(w.text()).not.toContain('请用新密码登录')
  })

  it('重置成功但没自动登进去：判定要看 status.signedIn，不能只看 ok', async () => {
    installAccountApi(signedOut(), {
      cloudResetPassword: vi.fn(async () => authOk('密码已重置，请用新密码登录', signedOut()))
    })
    const w = mountVm(AccountResetForm)
    await fillAndSubmit(w)

    await vi.waitFor(() => expect(w.emitted('done')).toBeTruthy())
    expect(useAuthStore().signedIn).toBe(false)
    expect(w.emitted('done')![0]).toEqual(['密码已重置，请用新密码登录'])
    expect(w.emitted('signed-in')).toBeFalsy()
  })

  it('重置失败：只报错，不写登录态、不发跳转事件', async () => {
    installAccountApi(signedOut(), {
      cloudResetPassword: vi.fn(async () => authFail('验证码不正确'))
    })
    const w = mountVm(AccountResetForm)
    await fillAndSubmit(w)

    await vi.waitFor(() => expect(w.text()).toContain('验证码不正确'))
    expect(useAuthStore().signedIn).toBe(false)
    expect(w.emitted('signed-in')).toBeFalsy()
    expect(w.emitted('done')).toBeFalsy()
  })
})

describe('AuthPage 找到密码后的衔接', () => {
  function makeAuthRouter() {
    return createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', redirect: '/auth' },
        { path: '/auth', name: 'auth', component: { template: '<div/>' } },
        { path: '/home', name: 'home', component: { template: '<div/>' } }
      ]
    })
  }

  async function toResetPage(cloudResetPassword: unknown) {
    installAccountApi(signedOut(), { cloudResetPassword })
    const router = makeAuthRouter()
    const w = mountVm(AuthPage, router)
    await router.isReady()
    await w.findAll('.tab').find((b) => b.text() === '找回密码')!.trigger('click')
    await vi.waitFor(() => expect(w.find('form.reset').exists()).toBe(true))

    await w.find('input[placeholder="注册时使用的邮箱"]').setValue('me@example.com')
    await w.find('.send-btn').trigger('click')
    await vi.waitFor(() => expect(w.find('.send-btn').text()).toContain('秒后重发'))
    await w.find('input.otp').setValue('123456')
    await w.find('input#reset-password').setValue('new123456')
    await w.find('input#reset-password-confirm').setValue('new123456')
    return { w, router }
  }

  it('自动登录成功：直接进 /home', async () => {
    const { w, router } = await toResetPage(vi.fn(async () => authOk('密码已重置', signedIn())))
    await submit(w, 'form.reset')

    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/home'))
  })

  it('自动登录失败：停在 /auth 的登录页，并把「请用新密码登录」保留在页面上', async () => {
    const { w, router } = await toResetPage(
      vi.fn(async () => authOk('密码已重置，请用新密码登录', signedOut()))
    )
    await submit(w, 'form.reset')

    // 提示写在 AuthPage 的 notice 上，表单切换标签不会把它带走
    await vi.waitFor(() => expect(w.text()).toContain('密码已重置，请用新密码登录'))
    expect(router.currentRoute.value.path).toBe('/auth')
    expect(w.find('form.login').exists()).toBe(true)
    expect(w.find('form.reset').exists()).toBe(false)
  })
})
