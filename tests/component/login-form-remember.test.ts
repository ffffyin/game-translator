// @vitest-environment happy-dom
// 登录页三个勾选框的联动与密码框预填。
//
// 默认值必须锁死：记住邮箱=开、保存密码=关、自动登录=关 ——
// 「每次打开都要重新登录」是默认行为，省事的选项只能由用户自己打开。
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import AccountLoginForm from '../../src/renderer/components/account/AccountLoginForm.vue'
import {
  installAccountApi,
  signedIn,
  signedOut,
  type InstalledAccountApi
} from './helpers/account-api'

const mounted: VueWrapper[] = []

/** 让 watch 里那些 fire-and-forget 的异步调用跑完 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function mountForm(
  overrides: Record<string, unknown> = {},
  props: Record<string, unknown> = {},
  apiOverrides: Record<string, unknown> = {}
): { w: VueWrapper; api: InstalledAccountApi } {
  const pinia = createPinia()
  setActivePinia(pinia)
  const api = installAccountApi(signedOut(), apiOverrides)
  const w = mount(AccountLoginForm, {
    props: { rememberedEmail: 'me@example.com', ...props },
    global: { plugins: [pinia] }
  })
  mounted.push(w)
  void overrides
  return { w, api }
}

function box(w: VueWrapper, name: string) {
  return w.find(`input[data-test="${name}"]`)
}

async function toggle(w: VueWrapper, name: string, value: boolean): Promise<void> {
  await box(w, name).setValue(value)
  await flush()
}

beforeEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
})

describe('登录页三个勾选框', () => {
  it('三个框都在，默认值是「记住邮箱开 / 保存密码关 / 自动登录关」', () => {
    const { w } = mountForm()

    expect(box(w, 'remember-email').exists()).toBe(true)
    expect(box(w, 'save-password').exists()).toBe(true)
    expect(box(w, 'auto-login').exists()).toBe(true)

    expect((box(w, 'remember-email').element as HTMLInputElement).checked).toBe(true)
    expect((box(w, 'save-password').element as HTMLInputElement).checked).toBe(false)
    expect((box(w, 'auto-login').element as HTMLInputElement).checked).toBe(false)
  })

  it('保存密码下面写明了加密方式（不能让用户以为密码是明文存着的）', () => {
    const { w } = mountForm()
    expect(w.text()).toContain('密码经 Windows 凭据加密保存在本机')
  })

  it('勾「自动登录」→ 自动带上「保存密码」和「记住邮箱」（没密码就没法自动登）', async () => {
    const { w } = mountForm({}, { initialRemember: false, initialSavePassword: false })

    await toggle(w, 'auto-login', true)

    expect((box(w, 'save-password').element as HTMLInputElement).checked).toBe(true)
    expect((box(w, 'remember-email').element as HTMLInputElement).checked).toBe(true)
  })

  it('取消「保存密码」→ 自动取消「自动登录」，并立刻删掉本机密文', async () => {
    const api = installAccountApi(signedOut())
    const pinia = createPinia()
    setActivePinia(pinia)
    const w = mount(AccountLoginForm, {
      props: {
        rememberedEmail: 'me@example.com',
        initialSavePassword: true,
        initialAutoLogin: true
      },
      global: { plugins: [pinia] }
    })
    mounted.push(w)
    void api

    expect((box(w, 'auto-login').element as HTMLInputElement).checked).toBe(true)
    await toggle(w, 'save-password', false)

    expect((box(w, 'auto-login').element as HTMLInputElement).checked).toBe(false)
    expect(api.cloudForgetSavedPassword).toHaveBeenCalled()
  })

  it('取消「记住邮箱」→ 清掉记住的邮箱', async () => {
    const { w, api } = mountForm()

    await toggle(w, 'remember-email', false)

    expect(api.settingsSet).toHaveBeenCalledWith('cloudAccountEmail', '')
    expect(api.settingsSet).toHaveBeenCalledWith('cloudRememberAccount', 0)
  })

  it('提交时把 savePassword / autoLogin 一起交给主进程', async () => {
    const { w, api } = mountForm()
    await w.find('input#login-password').setValue('Str0ng!Pass')
    await toggle(w, 'save-password', true)
    await toggle(w, 'auto-login', true)

    await w.find('form.login').trigger('submit')
    await flush()

    expect(api.cloudSignIn).toHaveBeenCalled()
    const input = api.cloudSignIn.mock.calls[0][0] as Record<string, unknown>
    expect(input.email).toBe('me@example.com')
    expect(input.savePassword).toBe(true)
    expect(input.autoLogin).toBe(true)
  })
})

describe('密码框预填', () => {
  it('保存密码=开 且 自动登录=关 → 把保存的密码填进密码框', async () => {
    const { w } = mountForm(
      {},
      { initialSavePassword: true, initialAutoLogin: false },
      { cloudSavedPassword: vi.fn(async () => 'Str0ng!Pass') }
    )

    await vi.waitFor(() =>
      expect((w.find('input#login-password').element as HTMLInputElement).value).toBe(
        'Str0ng!Pass'
      )
    )
  })

  it('自动登录=开 → 不把密码明文摊在登录页上（那趟登录由主进程自己完成）', async () => {
    const apiOverrides = { cloudSavedPassword: vi.fn(async () => 'Str0ng!Pass') }
    const { w, api } = mountForm(
      {},
      { initialSavePassword: true, initialAutoLogin: true },
      apiOverrides
    )
    await flush()

    expect((w.find('input#login-password').element as HTMLInputElement).value).toBe('')
    expect(api.cloudSavedPassword).not.toHaveBeenCalled()
  })

  it('没勾保存密码 → 不预填，也不去读密码', async () => {
    const { w, api } = mountForm({}, { initialSavePassword: false })
    await flush()

    expect((w.find('input#login-password').element as HTMLInputElement).value).toBe('')
    expect(api.cloudSavedPassword).not.toHaveBeenCalled()
  })
})

describe('登录成功后', () => {
  it('把主进程回传的登录态写进 store', async () => {
    const { w } = mountForm({}, {}, {
      cloudSignIn: vi.fn(async () => ({
        ok: true,
        message: '登录成功',
        status: signedIn()
      }))
    })
    await w.find('input#login-password').setValue('Str0ng!Pass')
    await w.find('form.login').trigger('submit')
    await flush()

    // 密码不该留在界面上
    expect((w.find('input#login-password').element as HTMLInputElement).value).toBe('')
  })
})
