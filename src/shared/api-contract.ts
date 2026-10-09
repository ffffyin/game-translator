import type { AppSettings } from './defaults'
import type { ModelConfigInput, ModelConfigView } from './model'
import type { HotkeyEntry } from './hotkeys'
import type { RegionRect } from './region'
import type { ResultData, RetranslateRequest } from './result'
import type { LibView, TermView, TermInput } from './terms'
import type { PhraseView, PhrasePageView, PhrasePageInput } from './phrases'
import type {
  AccountChangePasswordInput,
  AccountResetInput,
  AccountSignInInput,
  AccountSignUpInput
} from './account'
import type {
  CloudStatus,
  CloudOtpResult,
  CloudAuthResult,
  CloudSyncResult,
  CloudSimpleResult,
  CloudSummary
} from './cloud'

export interface NotifyPayload {
  type: 'ok' | 'error' | 'loading' | 'info'
  message: string
}

export interface TestResult {
  ok: boolean
  message: string
}

export interface RebindResult {
  ok: boolean
  error?: string
}

export interface UsageTotals {
  count: number
  chars: number
  tokens_in: number
  tokens_out: number
}

export interface UsageDay {
  day: string
  count: number
  chars: number
  tokens_in: number
  tokens_out: number
}

export interface QuotaResult {
  configId: number
  supported: boolean
  balanceText?: string
  amount?: number
  currency?: string
  expiresAt?: string
  checkedAt: string
  error?: string
}

// 渲染层可调用的全部主进程能力（preload 必须满足此契约）
export interface BackupFile {
  name: string
  mtime: string
  size: number
}

export interface ResetResult {
  ok: boolean
  removed?: string[]
  message?: string
}

export interface ApiContract {  ping: () => Promise<string>
  startupRoute: string | undefined
  settingsGetAll: () => Promise<AppSettings>
  settingsSet: (key: string, value: unknown) => Promise<AppSettings>
  openDataDir: () => Promise<boolean>
  getDataDir: () => Promise<string>
  openExternal: (url: string) => Promise<boolean>
  backupList: () => Promise<BackupFile[]>
  backupCreate: () => Promise<BackupFile[]>
  backupRestore: (name: string) => Promise<void>
  resetToDefaults: () => Promise<ResetResult>
  testTranslate: (
    text: string
  ) => Promise<{ ok: boolean; translation?: string; error?: string }>

  modelsList: () => Promise<ModelConfigView[]>
  modelsGet: (id: number) => Promise<ModelConfigView | undefined>
  modelsCreate: (input: ModelConfigInput) => Promise<ModelConfigView>
  modelsUpdate: (id: number, input: ModelConfigInput) => Promise<ModelConfigView>
  modelsDelete: (id: number) => Promise<void>
  modelsSetDefault: (id: number) => Promise<void>
  modelsTest: (id: number) => Promise<TestResult>

  usageTotals: () => Promise<UsageTotals>
  usageTotalsToday: () => Promise<UsageTotals>
  usageByConfig: () => Promise<
    Array<{
      config_id: number | null
      name: string
      count: number
      chars: number
      tokens_in: number
      tokens_out: number
    }>
  >
  usageAggregateDays: (days: number) => Promise<UsageDay[]>

  quotaQuery: (id: number) => Promise<QuotaResult>
  quotaQueryAll: () => Promise<QuotaResult[]>

  hotkeysGetAll: () => Promise<HotkeyEntry[]>
  hotkeysRebind: (actionCode: string, accelerator: string) => Promise<RebindResult>
  hotkeysSetEnabled: (actionCode: string, enabled: boolean) => Promise<void>

  onNotify: (cb: (p: NotifyPayload) => void) => () => void

  windowMinimize: () => void
  windowToggleMaximize: () => void
  windowClose: () => void
  windowIsMaximized: () => Promise<boolean>
  onWindowMaximized: (cb: (maximized: boolean) => void) => () => void

  regionSelect: (rect: RegionRect) => void
  regionCancel: () => void
  regionReady: () => void

  onResultData: (cb: (d: ResultData) => void) => () => void
  resultRetranslate: (req: RetranslateRequest) => Promise<RebindResult>
  resultSetPinned: (pinned: boolean) => void
  resultClose: () => void
  resultCopy: (text: string) => void

  termsListLibs: () => Promise<LibView[]>
  termsListTerms: (libId: number, search?: string) => Promise<TermView[]>
  termsCountTerms: (libId: number) => Promise<number>
  termsCreateLib: (input: { name: string; game?: string }) => Promise<number>
  termsRenameLib: (id: number, name: string) => Promise<void>
  termsDeleteLib: (id: number) => Promise<void>
  termsCreateTerm: (libId: number, input: TermInput) => Promise<number>
  termsUpdateTerm: (id: number, input: TermInput) => Promise<void>
  termsDeleteTerm: (id: number) => Promise<void>
  termsExportLib: (id: number) => Promise<{ ok: boolean; message: string }>
  termsImportLib: () => Promise<{ ok: boolean; message: string }>
  termsCheckUpdates: (
    url: string
  ) => Promise<{ ok: boolean; message?: string; updates?: unknown[] }>
  termsApplyUpdates: (
    url: string
  ) => Promise<{ ok: boolean; message: string; results?: unknown[] }>

  phrasesListPages: () => Promise<PhrasePageView[]>
  phrasesCreatePage: (input: PhrasePageInput) => Promise<number>
  phrasesUpdatePage: (id: number, patch: Partial<PhrasePageInput>) => Promise<void>
  phrasesRemovePage: (id: number) => Promise<{ ok: boolean; error?: string }>
  phrasesSetActivePage: (id: number) => Promise<void>

  phrasesList: (pageId?: number) => Promise<PhraseView[]>
  phrasesCreate: (pageId: number, content: string) => Promise<number>
  phrasesUpdate: (id: number, content: string) => Promise<void>
  phrasesSetEnabled: (id: number, enabled: boolean) => Promise<void>
  phrasesRemove: (id: number) => Promise<void>
  phrasesMove: (id: number, direction: 'up' | 'down') => Promise<void>

  // 云端账号与配置同步（可选功能：未登录/断网不影响任何本地能力）
  cloudStatus: () => Promise<CloudStatus>
  cloudLocalSummary: () => Promise<CloudSummary>
  /** 发验证码。usage 决定走「注册发码」还是「重置密码发码」，两条链路使用不同 usage */
  cloudSendOtp: (email: string, usage: 'register' | 'reset') => Promise<CloudOtpResult>
  cloudSignIn: (input: AccountSignInInput) => Promise<CloudAuthResult>
  cloudSignUp: (input: AccountSignUpInput) => Promise<CloudAuthResult>
  cloudResetPassword: (input: AccountResetInput) => Promise<CloudAuthResult>
  cloudChangePassword: (input: AccountChangePasswordInput) => Promise<CloudSimpleResult>
  cloudSignOut: () => Promise<CloudSimpleResult>
  cloudPush: () => Promise<CloudSyncResult>
  cloudPull: () => Promise<CloudSyncResult>
  cloudRemoveRemote: () => Promise<CloudSimpleResult>
}
