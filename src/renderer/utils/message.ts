/**
 * 上屏文案的最后一道兜底。
 *
 * 主进程已经做过归一，但 IPC 是「谁都能调」的通道（开发者工具、旧版本 main 都算），
 * 渲染层必须再挡一道：**任何不含中文字符的原文都不允许直接上屏**。
 * 典型漏网 case 是后端把校验正则 `^$|^.{4,60}$` 之类的英文原文回传，
 * 用户看到一串符号只会更懵，统一换成一句人话。
 */
const HAN = /[\u4e00-\u9fa5]/
const MAX_LEN = 160

export const GENERIC_ERROR = '操作失败，请稍后重试'
export const GENERIC_OK = '操作成功'

function pick(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return fallback
  if (!HAN.test(text)) return fallback
  return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}…` : text
}

/** 失败文案：非中文一律降级为 fallback */
export function friendlyError(raw: unknown, fallback: string = GENERIC_ERROR): string {
  return pick(raw, fallback)
}

/** 成功文案：同一条规则，避免成功路径冒出英文原文 */
export function friendlyOk(raw: unknown, fallback: string = GENERIC_OK): string {
  return pick(raw, fallback)
}
