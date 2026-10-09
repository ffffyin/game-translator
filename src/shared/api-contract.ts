import type { AppSettings } from './defaults'
import type { ModelConfigInput, ModelConfigView } from './model'
import type { HotkeyEntry } from './hotkeys'
import type { RegionRect } from './region'
import type { ResultData, RetranslateRequest } from './result'
import type { LibView, TermView, TermInput } from './terms'
import type { UpdateCheckResult } from './update'
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

/** 应用内下载安装包的结果：成功给落盘路径，失败给一句用户能看懂的原因 */
export type UpdateDownloadResult =
  | { ok: true; path: string }
  | { ok: false; message: string; canceled?: boolean }

/** 下载进度。total 为 0 表示服务器没给总大小（此时 percent 恒为 0） */
export interface UpdateProgress {
  received: number
  total: number
  percent: number
}

export interface ApiContract {  ping: () => Promise<string>
  startupRoute: string | undefined
  settingsGetAll: () => Promise<AppSettings>
  settingsSet: (key: string, value: unknown) => Promise<AppSettings>
  openDataDir: () => Promise<boolean>
  getDataDir: () => Promise<string>
  openExternal: (url: string) => Promise<boolean>
  /** 检查软件更新：拉远端清单比对版本，失败也按 result.message 展示，不抛 */
  checkUpdate: () => Promise<UpdateCheckResult>
  /**
   * 用系统浏览器打开更新包下载地址。
   *
   * 只留给官网 / 兜底用；软件里的「立即更新」走下面的 updateDownload，
   * 在应用内下载（走系统代理，带进度，下来直接装）。
   */
  openDownload: (url: string) => Promise<boolean>
  /** 应用内下载安装包，带进度回调（走 IPC 推送，不走这里的返回值） */
  updateDownload: (
    url: string,
    sha256: string,
    size: number
  ) => Promise<UpdateDownloadResult>
  /** 取消正在进行的下载；没有下载时也是成功 */
  updateCancel: () => Promise<{ ok: boolean }>
  /** 运行已下载的安装包并退出软件 */
  updateInstall: (path: string) => Promise<UpdateDownloadResult>
  /** 在文件管理器里定位安装包 */
  updateReveal: (path: string) => Promise<{ ok: boolean; message?: string }>
  onUpdateProgress: (cb: (p: UpdateProgress) => void) => () => void
  backupList: () => Promise<BackupFile[]>
  backupCreate: () => Promise<BackupFile[]>
  backupRestore: (name: string) => Promise<void>
  resetToDefaults: () => Promise<ResetResult>
  /**
   * 主页手动测试卡：翻译一段文字。
   *
   * scope 决定走哪组方向：`chat` 聊天方向（替换/复制翻译），
   * `screen` 画面方向（截图翻译）。传 undefined 按 chat 处理。
   */
  testTranslate: (
    text: string,
    scope?: 'chat' | 'screen'
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
  /** 切换画面翻译方向（`"源|目标"`）并写入设置，之后一直生效 */
  resultSetDirection: (direction: string) => Promise<RebindResult>
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

  // 云端账号与配置同步（登录是强制的：未通过云端验证就不能进入软件）
  /**
   * 启动门控：渲染层起来后第一个调用。
   *
   * 未开启「自动登录」时清掉本机会话并返回未登录 —— 这就是「每次打开都要重新登录」；
   * 开启时用保存的邮箱 + 密码走一次真实网络登录，成功才返回已登录。
   */
  cloudPrepareBoot: () => Promise<CloudStatus>
  cloudStatus: () => Promise<CloudStatus>
  /**
   * 登录框预填用的密码明文。只在「保存密码=开 且 自动登录=关」时非空，
   * 其余一律 ''。调用方只能把它塞进密码输入框，不许落盘、不许打日志。
   */
  cloudSavedPassword: () => Promise<string>
  /** 取消「保存密码」时立刻删除本机密文并关闭自动登录 */
  cloudForgetSavedPassword: () => Promise<CloudSimpleResult>
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
