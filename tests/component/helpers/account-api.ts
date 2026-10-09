// @vitest-environment happy-dom
/**
 * 账号链路的 window.api 桩。
 *
 * 三个账号相关组件测试（账号页 / 登录门 / API 上云开关）共用这一份，
 * 避免每个文件各自维护一套 mock —— 签名一旦改，只改这里。
 */
import { vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/shared/defaults'
import type {
  CloudAuthResult,
  CloudOtpResult,
  CloudSimpleResult,
  CloudStatus,
  CloudSummary,
  CloudSyncResult
} from '../../../src/shared/cloud'

export const SUMMARY: CloudSummary = { termLibs: 2, terms: 20, phrasePages: 3, phrases: 24 }

export function signedOut(over: Partial<CloudStatus> = {}): CloudStatus {
  return {
    available: true,
    signedIn: false,
    userId: null,
    email: null,
    phone: null,
    accountName: null,
    remoteUpdatedAt: null,
    remoteSummary: null,
    online: true,
    message: '未登录',
    ...over
  }
}

export function signedIn(over: Partial<CloudStatus> = {}): CloudStatus {
  return {
    available: true,
    signedIn: true,
    userId: 'uid-1',
    email: 'me@example.com',
    phone: null,
    accountName: '阿强',
    remoteUpdatedAt: '2026-10-09T08:00:00.000Z',
    remoteSummary: SUMMARY,
    online: true,
    message: '已登录',
    ...over
  }
}

export function otpOk(over: Partial<CloudOtpResult> = {}): CloudOtpResult {
  return {
    ok: true,
    message: '验证码已发送',
    verificationId: 'vid-1',
    isExistingUser: false,
    ...over
  }
}

export function authOk(message: string, status: CloudStatus): CloudAuthResult {
  return { ok: true, message, status }
}

export function authFail(message: string, status: CloudStatus = signedOut()): CloudAuthResult {
  return { ok: false, message, status }
}

export function simpleOk(message = '操作成功'): CloudSimpleResult {
  return { ok: true, message }
}

export function syncOk(message = '已保存到云端'): CloudSyncResult {
  return { ok: true, message, summary: SUMMARY, updatedAt: '2026-10-09T08:00:00.000Z' }
}

export type AccountApiOverrides = Partial<Record<string, unknown>>

export interface InstalledAccountApi {
  cloudPrepareBoot: ReturnType<typeof vi.fn>
  cloudStatus: ReturnType<typeof vi.fn>
  cloudSavedPassword: ReturnType<typeof vi.fn>
  cloudForgetSavedPassword: ReturnType<typeof vi.fn>
  cloudLocalSummary: ReturnType<typeof vi.fn>
  cloudSendOtp: ReturnType<typeof vi.fn>
  cloudSignIn: ReturnType<typeof vi.fn>
  cloudSignUp: ReturnType<typeof vi.fn>
  cloudResetPassword: ReturnType<typeof vi.fn>
  cloudChangePassword: ReturnType<typeof vi.fn>
  cloudSignOut: ReturnType<typeof vi.fn>
  cloudPush: ReturnType<typeof vi.fn>
  cloudPull: ReturnType<typeof vi.fn>
  cloudRemoveRemote: ReturnType<typeof vi.fn>
  settingsGetAll: ReturnType<typeof vi.fn>
  settingsSet: ReturnType<typeof vi.fn>
  modelsList: ReturnType<typeof vi.fn>
  windowIsMaximized: ReturnType<typeof vi.fn>
  onWindowMaximized: ReturnType<typeof vi.fn>
  onNotify: ReturnType<typeof vi.fn>
}

/**
 * 安装 window.api 桩。
 *
 * cloudSyncApi 被塞进 settings 桩里（真实实现里它属于 AppSettings + 主进程白名单，
 * 主进程侧尚未补齐全之前，settingsSet 会抛 Unknown setting）。
 */
export function installAccountApi(
  status: CloudStatus,
  overrides: AccountApiOverrides = {}
): InstalledAccountApi {
  const bag: Record<string, unknown> = { ...DEFAULT_SETTINGS, cloudSyncApi: 0 }

  const api = {
    // 启动门控：默认「未开启自动登录 → 停在登录页」，用例可自行覆盖
    cloudPrepareBoot: vi.fn(async () => status),
    cloudStatus: vi.fn(async () => status),
    // 预填密码：默认「本机没存过」，即不预填
    cloudSavedPassword: vi.fn(async () => ''),
    cloudForgetSavedPassword: vi.fn(async () => simpleOk('已清除本机保存的密码')),
    cloudLocalSummary: vi.fn(async () => SUMMARY),
    cloudSendOtp: vi.fn(async () => otpOk()),
    cloudSignIn: vi.fn(async () => authOk('登录成功', signedIn())),
    cloudSignUp: vi.fn(async () => authOk('注册成功，已登录', signedIn())),
    cloudResetPassword: vi.fn(async () => authOk('密码已重置，请用新密码登录', signedOut())),
    cloudChangePassword: vi.fn(async () => simpleOk('密码已修改')),
    cloudSignOut: vi.fn(async () => {
      status = signedOut()
      return simpleOk('已退出登录')
    }),
    cloudPush: vi.fn(async () => syncOk('已保存到云端')),
    cloudPull: vi.fn(async () => syncOk('已从云端恢复')),
    cloudRemoveRemote: vi.fn(async () => simpleOk('已删除云端配置')),

    settingsGetAll: vi.fn(async () => ({ ...bag })),
    settingsSet: vi.fn(async (key: string, value: unknown) => {
      bag[key] = value
      return { ...bag }
    }),

    modelsList: vi.fn(async () => []),
    windowIsMaximized: vi.fn(async () => false),
    onWindowMaximized: vi.fn(() => () => undefined),
    onNotify: vi.fn(() => () => undefined),
    ...overrides
  }

  ;(window as unknown as { api: unknown }).api = api
  return api as unknown as InstalledAccountApi
}
