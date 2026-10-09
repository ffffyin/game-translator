import { describe, it, expect } from 'vitest'
import {
  EMAIL_MAX_LENGTH,
  NICKNAME_MAX,
  NICKNAME_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  maskEmail,
  normalizeNickname,
  passwordStrength,
  validateCode,
  validateEmail,
  validateNickname,
  validatePassword
} from '../../src/shared/account'

// 长度一律按「字符」算（[...s].length），与后端按 rune 计数一致：
// emoji 在 JS 里占 2 个 UTF-16 码元，用 String.length 会把合法的密码误判成超长。
const rep = (unit: string, n: number): string => unit.repeat(n)

describe('密码校验', () => {
  it('下限边界：5 位拒绝、6 位通过、7 位通过', () => {
    expect(validatePassword(rep('a', PASSWORD_MIN - 1)).ok).toBe(false)
    expect(validatePassword(rep('a', PASSWORD_MIN)).ok).toBe(true)
    expect(validatePassword(rep('a', PASSWORD_MIN + 1)).ok).toBe(true)
    expect(validatePassword(rep('a', PASSWORD_MIN - 1)).message).toBe(`密码至少 ${PASSWORD_MIN} 位`)
  })

  it('上限边界：59/60 位通过，61 位拒绝', () => {
    expect(validatePassword(rep('a', PASSWORD_MAX - 1)).ok).toBe(true)
    expect(validatePassword(rep('a', PASSWORD_MAX)).ok).toBe(true)
    expect(validatePassword(rep('a', PASSWORD_MAX + 1)).ok).toBe(false)
    expect(validatePassword(rep('a', PASSWORD_MAX + 1)).message).toBe(`密码最多 ${PASSWORD_MAX} 位`)
  })

  it('上限锁死在 60（后端正则 ^$|^.{4,60}$），不能是 64', () => {
    expect(PASSWORD_MAX).toBe(60)
  })

  it('空密码与纯空格密码都被拒绝', () => {
    expect(validatePassword('').ok).toBe(false)
    expect(validatePassword('      ').ok).toBe(false)
    expect(validatePassword('      ').message).toBe('密码不能全是空格')
  })

  it('含换行/回车一律拒绝：从聊天窗口粘贴进来会带换行，服务端会算进长度', () => {
    expect(validatePassword('abc123\n').ok).toBe(false)
    expect(validatePassword('abc123\r').ok).toBe(false)
    expect(validatePassword('abc\n123').ok).toBe(false)
    expect(validatePassword('abc123\n').message).toBe('密码不能包含换行')
  })

  it('首尾空格合法且不被 trim：长度按原样算', () => {
    expect(validatePassword('  abc123  ').ok).toBe(true)
    expect(validatePassword(' abc123 ').ok).toBe(true)
  })

  it('emoji 按 1 个字符计数，不按 UTF-16 码元', () => {
    // 30 个 emoji：码元数是 60，字符数是 30
    expect(rep('😀', 30).length).toBe(60)
    expect(validatePassword(rep('😀', 30)).ok).toBe(true)
    // 31 个 emoji：字符数 31，仍在 60 以内
    expect(validatePassword(rep('😀', PASSWORD_MAX)).ok).toBe(true)
    expect(validatePassword(rep('😀', PASSWORD_MAX + 1)).ok).toBe(false)
  })

  it('非字符串输入按空串处理，不抛异常', () => {
    // @ts-expect-error 故意传错类型：IPC 边界上可能出现
    expect(validatePassword(undefined).ok).toBe(false)
    // @ts-expect-error 同上
    expect(validatePassword(123).ok).toBe(false)
  })
})

describe('密码强度', () => {
  it('不足 8 位或超过上限一律最弱', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('abc12!')).toBe(0)
    expect(passwordStrength(rep('a', PASSWORD_MAX + 1))).toBe(0)
  })

  it('单一字符种类一律最弱（纯字母 / 纯数字 / 纯符号）', () => {
    expect(passwordStrength('abcdefghij')).toBe(0)
    expect(passwordStrength('1234567890')).toBe(0)
    expect(passwordStrength('!@#$%^&*()')).toBe(0)
  })

  it('两种字符但不足 10 位 → 中', () => {
    expect(passwordStrength('abc12345')).toBe(1)
  })

  it('两种字符满 10 位 → 较强', () => {
    expect(passwordStrength('abc1234567')).toBe(2)
  })

  it('三种字符满 8 位 → 较强，满 12 位 → 强', () => {
    expect(passwordStrength('abc1234!')).toBe(2)
    expect(passwordStrength('abc1234!abcd')).toBe(3)
  })

  it('大小写不额外加档', () => {
    expect(passwordStrength('Abcdefgh')).toBe(0)
    expect(passwordStrength('Abcdefgh1')).toBe(1)
  })
})

describe('昵称校验（仅展示，不参与鉴权）', () => {
  it('空白与过短被拒绝', () => {
    expect(validateNickname('').ok).toBe(false)
    expect(validateNickname('   ').ok).toBe(false)
    expect(validateNickname('').message).toBe('请输入昵称')
    expect(validateNickname('a').ok).toBe(false)
    expect(validateNickname('a').message).toBe(`昵称至少 ${NICKNAME_MIN} 个字符`)
  })

  it('长度边界：2 位与 16 位通过，17 位拒绝', () => {
    expect(validateNickname(rep('a', NICKNAME_MIN)).ok).toBe(true)
    expect(validateNickname(rep('a', NICKNAME_MAX)).ok).toBe(true)
    expect(validateNickname(rep('a', NICKNAME_MAX + 1)).ok).toBe(false)
    expect(validateNickname(rep('a', NICKNAME_MAX + 1)).message).toBe(
      `昵称最多 ${NICKNAME_MAX} 个字符`
    )
  })

  it('含 @ 被拒绝：昵称不能长得像邮箱，免得用户以为它要用来登录', () => {
    expect(validateNickname('abc@qq.com').ok).toBe(false)
    expect(validateNickname('a@b').ok).toBe(false)
    expect(validateNickname('a@b').message).toBe('昵称不能包含 @')
  })

  it('含空格（含中间空格）被拒绝', () => {
    expect(validateNickname('a b').ok).toBe(false)
    expect(validateNickname('老 王').ok).toBe(false)
    expect(validateNickname('a b').message).toBe('昵称不能包含空格')
  })

  it('trim 后再判长度：前后空格不算进昵称', () => {
    expect(validateNickname('  ab  ').ok).toBe(true)
    expect(normalizeNickname('  老王  ')).toBe('老王')
  })

  it('中文按字符计数，16 个汉字合法', () => {
    expect(validateNickname(rep('王', NICKNAME_MAX)).ok).toBe(true)
    expect(validateNickname(rep('王', NICKNAME_MAX + 1)).ok).toBe(false)
  })
})

describe('邮箱校验', () => {
  it('常规邮箱通过，缺 @ / 缺域名点号被拒绝', () => {
    expect(validateEmail('abc@qq.com').ok).toBe(true)
    expect(validateEmail('abc@qq').ok).toBe(false)
    expect(validateEmail('abc').ok).toBe(false)
    expect(validateEmail('a b@qq.com').ok).toBe(false)
  })

  it('空与超长被拒绝，超长优先报「过长」', () => {
    expect(validateEmail('').message).toBe('请输入邮箱地址')
    const long = `${rep('a', EMAIL_MAX_LENGTH - 5)}@qq.com`
    expect(long.length).toBeGreaterThan(EMAIL_MAX_LENGTH)
    expect(validateEmail(long).message).toBe('邮箱地址过长')
  })

  it('前后空格先 trim', () => {
    expect(validateEmail('  abc@qq.com  ').ok).toBe(true)
  })
})

describe('验证码校验', () => {
  it('4~8 位纯数字通过，其余一律拒绝', () => {
    expect(validateCode('1234').ok).toBe(true)
    expect(validateCode('12345678').ok).toBe(true)
    expect(validateCode('123').ok).toBe(false)
    expect(validateCode('123456789').ok).toBe(false)
    expect(validateCode('12a4').ok).toBe(false)
    expect(validateCode('').ok).toBe(false)
  })
})

describe('邮箱脱敏（日志里不许出现完整邮箱）', () => {
  it('常规邮箱只保留首字符与域名', () => {
    expect(maskEmail('abc@qq.com')).toBe('a***@qq.com')
    expect(maskEmail('a@b.com')).toBe('a***@b.com')
    expect(maskEmail('zhang.san@sub.example.com')).toBe('z***@sub.example.com')
  })

  it('前后空格先 trim 再脱敏', () => {
    expect(maskEmail('  abc@qq.com  ')).toBe('a***@qq.com')
  })

  it('不是邮箱时原样返回（总比给出看似脱敏的假象安全）', () => {
    expect(maskEmail('not-an-email')).toBe('not-an-email')
    expect(maskEmail('')).toBe('')
    expect(maskEmail('@qq.com')).toBe('@qq.com')
  })

  it('非字符串输入返回空串而不抛异常', () => {
    // @ts-expect-error 故意传错类型
    expect(maskEmail(undefined)).toBe('')
    // @ts-expect-error 同上
    expect(maskEmail(null)).toBe('')
  })
})
