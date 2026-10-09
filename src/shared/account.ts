// 账号输入校验与脱敏（纯函数：不 import electron、不发网络请求，可直接在单测里跑）
//
// 三条边界，改动前先看这里：
//  1. **登录标识是邮箱**。昵称只用于展示，绝不参与鉴权 —— SDK 的 auth 上没有任何
//     可写的账号名字段（updateUser / updateProfile / setUsername 实测全为 false，
//     只有只读的 getUser()），服务端也没有这个字段。
//  2. **密码首尾空格合法**，所以一律不 trim；但必须拦掉 \n / \r —— 用户从聊天窗口
//     复制粘贴进来会带换行，服务端会把换行算进长度，表现为「长度看着够却报错」。
//  3. PASSWORD_MAX 必须锁 60，不能写成 64：后端正则 ^$|^.{4,60}$ 校验失败时
//     会把英文正则原文直接回给用户，前端不加严就会漏到界面上。

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const EMAIL_MAX_LENGTH = 254
export const PASSWORD_MIN = 6
/** 后端硬上限，不是随手取的数：见文件头第 3 条 */
export const PASSWORD_MAX = 60
export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 16
export const CODE_MIN = 4
export const CODE_MAX = 8
export const CODE_RE = /^\d{4,8}$/

export interface Validated {
  ok: boolean
  message: string
}

/** trim 后为空即视为全空白（含全角空格等 trim 能识别的空白） */
function isBlank(s: string): boolean {
  return s.trim().length === 0
}

function firstString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

const OK: Validated = { ok: true, message: '' }

export function validateEmail(raw: string): Validated {
  const mail = firstString(raw).trim()
  if (!mail) return { ok: false, message: '请输入邮箱地址' }
  // 长度先判：超长的邮箱必然也不匹配正则，先报「过长」才能给出真正的原因
  if (mail.length > EMAIL_MAX_LENGTH) return { ok: false, message: '邮箱地址过长' }
  if (!EMAIL_RE.test(mail)) return { ok: false, message: '请输入正确的邮箱地址' }
  return OK
}

/**
 * 按「字符」数长度，不是 UTF-16 码元数。
 *
 * 后端按 rune 计数，emoji/部分生僻字在 JS 里占 2 个码元（'😀'.length === 2）。
 * 用 String.length 会让含 emoji 的密码被前端误判为超长，而后端明明收得下。
 */
function charLen(s: string): number {
  return [...s].length
}

export function validatePassword(raw: string): Validated {
  const pwd = firstString(raw)
  // 首尾空格合法，这里刻意不 trim
  if (pwd.includes('\n') || pwd.includes('\r')) return { ok: false, message: '密码不能包含换行' }
  const n = charLen(pwd)
  if (n < PASSWORD_MIN) return { ok: false, message: `密码至少 ${PASSWORD_MIN} 位` }
  if (n > PASSWORD_MAX) return { ok: false, message: `密码最多 ${PASSWORD_MAX} 位` }
  if (isBlank(pwd)) return { ok: false, message: '密码不能全是空格' }
  return OK
}

/**
 * 密码强度档位：0 弱 / 1 中 / 2 较强 / 3 强。
 *
 * 只看「字符种类」和长度两个维度，刻意不做字典/常见密码判断 —— 那类判断无法离线
 * 做到可靠，宁可在界面上如实显示为「弱」，也不假装能识别 123456。
 */
export function passwordStrength(raw: string): 0 | 1 | 2 | 3 {
  const pwd = firstString(raw)
  const hasLetter = /[a-zA-Z]/.test(pwd)
  const hasDigit = /\d/.test(pwd)
  const hasSymbol = /[^a-zA-Z0-9]/.test(pwd)
  // 大小写算同一类：Password 与 password 的强度差异远没有多一个字符种类来得大
  const kinds = (hasLetter ? 1 : 0) + (hasDigit ? 1 : 0) + (hasSymbol ? 1 : 0)
  // 同样按字符数，与 validatePassword 保持一致
  const n = charLen(pwd)

  if (n < 8 || n > PASSWORD_MAX) return 0
  // 单一字符种类一律最弱：纯数字、纯字母、纯符号都在此列
  if (kinds <= 1) return 0
  if (kinds >= 3 && n >= 12) return 3
  if (kinds >= 3 && n >= 8) return 2
  if (kinds >= 2 && n >= 10) return 2
  return 1
}

export function validateNickname(raw: string): Validated {
  const name = firstString(raw).trim()
  if (!name) return { ok: false, message: '请输入昵称' }
  if (name.includes('@')) return { ok: false, message: '昵称不能包含 @' }
  if (/\s/.test(name)) return { ok: false, message: '昵称不能包含空格' }
  if (name.length < NICKNAME_MIN) return { ok: false, message: `昵称至少 ${NICKNAME_MIN} 个字符` }
  if (name.length > NICKNAME_MAX) return { ok: false, message: `昵称最多 ${NICKNAME_MAX} 个字符` }
  return OK
}

export function normalizeNickname(raw: string): string {
  return firstString(raw).trim()
}

export function validateCode(raw: string): Validated {
  const code = firstString(raw).trim()
  if (!CODE_RE.test(code)) {
    return { ok: false, message: `验证码为 ${CODE_MIN}~${CODE_MAX} 位数字` }
  }
  return OK
}

/** 邮箱脱敏：abc@qq.com → a***@qq.com。日志里不许出现完整邮箱。 */
export function maskEmail(email: string): string {
  const mail = firstString(email).trim()
  if (!EMAIL_RE.test(mail)) return firstString(email)
  const at = mail.indexOf('@')
  const local = mail.slice(0, at)
  if (!local) return firstString(email)
  return `${local[0]}***${mail.slice(at)}`
}

// ---------------------------------------------------------------------------
// IPC 入参契约（preload 与渲染层必须照此调用）
// ---------------------------------------------------------------------------

export interface AccountSignInInput {
  email: string
  password: string
  /** 是否记住账号：勾选后本机保留邮箱明文，下次进登录框自动填充 */
  remember: boolean
  /**
   * 是否把密码用 DPAPI 加密保存在本机（默认 false）。
   *
   * 存的是密文，不是明文；且只能由主进程写入，渲染层只传这个开关。
   * 取消勾选时主进程会立刻删除已存的密文，本机不留残余。
   */
  savePassword?: boolean
  /**
   * 是否开启「下次启动自动登录」（默认 false）。
   *
   * 自动登录必须有密码可用，所以主进程里 `autoLogin=true` 会**隐含**
   * `savePassword=true` —— 只勾自动登录而不存密码是做不到的。
   */
  autoLogin?: boolean
}

export interface AccountSignUpInput {
  /** 昵称，仅展示用，不参与鉴权 */
  nickname: string
  email: string
  password: string
  verificationId: string
  code: string
}

export interface AccountResetInput {
  email: string
  verificationId: string
  code: string
  newPassword: string
}

export interface AccountChangePasswordInput {
  oldPassword: string
  newPassword: string
}
