// AI 模型额度查询适配器（T5-1）
import { findProvider, inferTemplateByHost, type ProviderTemplate } from '../../shared/providers'
import type { ModelConfigView } from '../../shared/model'
import type { ModelConfigService } from './model-config'

export { inferTemplateByHost }

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

function trimSlash(s: string): string {
  return s.replace(/\/+$/, '')
}

function joinPath(base: string, path: string): string {
  return trimSlash(base) + path
}

// DeepSeek 的余额接口与 /v1 同级：https://api.deepseek.com/user/balance
function deepseekUrl(base: string, path: string): string {
  return trimSlash(base.replace(/\/v1\/?$/i, '')) + path
}

// 决定用哪套适配器：
// 先按 base_url 主机名识别真实厂商（「自定义」模板被误填官方地址时以此纠偏），
// 未命中再回落到用户所选的 provider 模板。
function resolveQuotaTemplate(view: ModelConfigView): ProviderTemplate | undefined {
  const byHost = inferTemplateByHost(view.base_url ?? '')
  if (byHost?.quotaKind && byHost.quotaPath) return byHost
  return findProvider(view.provider)
}

async function authGet(url: string, key: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  })
}

function fail(view: ModelConfigView, error: string, checkedAt: string): QuotaResult {
  return { configId: view.id, supported: true, checkedAt, error }
}

// DeepSeek 风格余额响应：{ is_available, balance_infos:[{currency,total_balance}] }
function parseDeepseekBalance(
  view: ModelConfigView,
  j: unknown,
  checkedAt: string
): QuotaResult | null {
  const withKey = j as {
    is_available?: boolean
    balance_infos?: Array<{ currency: string; total_balance: string | number }>
  }
  const info = withKey?.balance_infos?.[0]
  if (!info) return null
  const amount = Number(info.total_balance)
  return {
    configId: view.id,
    supported: true,
    amount,
    currency: info.currency,
    balanceText: `${info.total_balance} ${info.currency}`,
    checkedAt
  }
}

// 回退探测：部分直连官方的地址只提供 DeepSeek 风格余额接口
async function tryDeepseekStyle(
  view: ModelConfigView,
  key: string,
  checkedAt: string
): Promise<QuotaResult | null> {
  try {
    const r = await authGet(deepseekUrl(view.base_url, '/user/balance'), key)
    if (!r.ok) return null
    return parseDeepseekBalance(view, await r.json(), checkedAt)
  } catch {
    return null
  }
}

export async function queryQuota(
  models: ModelConfigService,
  view: ModelConfigView
): Promise<QuotaResult> {
  const checkedAt = new Date().toISOString()
  const tpl = resolveQuotaTemplate(view)
  if (!tpl?.quotaPath || !tpl.quotaKind) {
    return { configId: view.id, supported: false, checkedAt }
  }
  if (!view.hasKey) {
    return fail(view, '未填写 API Key，无法查询', checkedAt)
  }

  const raw = models.getForEngine(view.id)
  if (!raw?.api_key_enc) return fail(view, '未填写 API Key，无法查询', checkedAt)
  const key = await (await import('./crypto')).dpapiDecrypt(raw.api_key_enc)

  try {
    if (tpl.quotaKind === 'deepseek') {
      const r = await authGet(deepseekUrl(view.base_url, tpl.quotaPath), key)
      if (!r.ok) {
        if (r.status === 404) {
          return fail(
            view,
            '查询失败：HTTP 404（该地址未提供 DeepSeek 余额接口 /user/balance，请确认 API 地址是否为官方地址）',
            checkedAt
          )
        }
        return fail(view, `查询失败：HTTP ${r.status}`, checkedAt)
      }
      const parsed = parseDeepseekBalance(view, await r.json(), checkedAt)
      if (!parsed) return fail(view, '余额接口返回格式无法解析', checkedAt)
      return parsed
    }

    if (tpl.quotaKind === 'openrouter') {
      const r = await authGet(joinPath(view.base_url, tpl.quotaPath), key)
      if (!r.ok) return fail(view, `查询失败：HTTP ${r.status}`, checkedAt)
      const j = (await r.json()) as {
        data?: { total_credits: number; total_usage: number }
      }
      const d = j.data
      if (typeof d?.total_credits !== 'number') {
        return fail(view, '余额接口返回格式无法解析', checkedAt)
      }
      const remaining = d.total_credits - d.total_usage
      return {
        configId: view.id,
        supported: true,
        amount: remaining,
        currency: 'USD',
        balanceText: `$${remaining.toFixed(2)}`,
        checkedAt
      }
    }

    // newapi / one-api 中转站：subscription 给总额度，usage 给已用（单位：美分）
    const subR = await authGet(joinPath(view.base_url, tpl.quotaPath), key)
    if (subR.status === 404) {
      // 该地址不是 one-api/new-api 中转站（例如自定义模板填了官方直连地址）：
      // 回退探测 DeepSeek 风格余额接口，仍失败则给出可操作的提示
      const fallback = await tryDeepseekStyle(view, key, checkedAt)
      if (fallback) return fallback
      return fail(
        view,
        '查询失败：HTTP 404（该地址未提供 one-api/new-api 余额接口；若是直连官方厂商，请在「AI 模型配置」把厂商模板改为对应厂商）',
        checkedAt
      )
    }
    if (!subR.ok) return fail(view, `查询失败：HTTP ${subR.status}`, checkedAt)
    const sub = (await subR.json()) as {
      hard_limit_usd?: number
      access_until?: number
    }
    if (typeof sub.hard_limit_usd !== 'number') {
      return fail(view, '余额接口返回格式无法解析', checkedAt)
    }
    let used = 0
    try {
      const useR = await authGet(joinPath(view.base_url, '/dashboard/billing/usage'), key)
      if (useR.ok) {
        const useJ = (await useR.json()) as { total_usage?: number }
        if (typeof useJ.total_usage === 'number') used = useJ.total_usage / 100
      }
    } catch {
      // 部分中转站不提供 usage：退化为只显示总额度
    }
    const remaining = sub.hard_limit_usd - used
    let expiresAt: string | undefined
    if (sub.access_until && sub.access_until > 0) {
      expiresAt = new Date(sub.access_until * 1000).toISOString()
    }
    return {
      configId: view.id,
      supported: true,
      amount: remaining,
      currency: 'USD',
      balanceText: `$${remaining.toFixed(2)}`,
      expiresAt,
      checkedAt
    }
  } catch (err) {
    return fail(
      view,
      err instanceof Error ? `网络错误：${err.message}` : '查询失败',
      checkedAt
    )
  }
}
