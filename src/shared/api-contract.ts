import type { AppSettings } from './defaults'
import type { ModelConfigInput, ModelConfigView } from './model'
import type { HotkeyEntry } from './hotkeys'
import type { RegionRect } from './region'
import type { ResultData, RetranslateRequest } from './result'
import type { LibView, TermView, TermInput } from './terms'
import type { PhraseView } from './phrases'

export interface NotifyPayload {
  type: 'ok' | 'error' | 'loading'
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

export interface ApiContract {  ping: () => Promise<string>
  startupRoute: string | undefined
  settingsGetAll: () => Promise<AppSettings>
  settingsSet: (key: string, value: unknown) => Promise<AppSettings>
  openDataDir: () => Promise<boolean>
  getDataDir: () => Promise<string>
  backupList: () => Promise<BackupFile[]>
  backupCreate: () => Promise<BackupFile[]>
  backupRestore: (name: string) => Promise<void>
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

  phrasesList: () => Promise<PhraseView[]>
  phrasesCreate: (content: string) => Promise<number>
  phrasesUpdate: (id: number, content: string) => Promise<void>
  phrasesSetEnabled: (id: number, enabled: boolean) => Promise<void>
  phrasesRemove: (id: number) => Promise<void>
  phrasesMove: (id: number, direction: 'up' | 'down') => Promise<void>
}
