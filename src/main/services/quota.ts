// AI 模型额度查询适配器（T5-1）
import { findProvider } from '../../shared/providers'
import type { ModelConfigView } from '../../shared/model'
import type { ModelConfigService } from './model-config'

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

async function authGet(url: string, key: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  })
}

function fail(view: ModelConfigView, error: string, checkedAt: string): QuotaResult {
  return { configId: view.id, supported: true, checkedAt, error }
}

export async function queryQuota(
  models: ModelConfigService,
  view: ModelConfigView
): Promise<QuotaResult> {
  const checkedAt = new Date().toISOString()
  const tpl = findProvider(view.provider)
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
      if (!r.ok) return fail(view, `查询失败：HTTP ${r.status}`, checkedAt)
      const j = (await r.json()) as {
        is_available?: boolean
        balance_infos?: Array<{ currency: string; total_balance: string | number }>
      }
      const info = j.balance_infos?.[0]
      if (!info) return fail(view, '余额接口返回格式无法解析', checkedAt)
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
