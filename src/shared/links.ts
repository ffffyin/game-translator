// 作者联系方式与外链安全校验（纯逻辑，可单测）
export const AUTHOR_NAME = 'fygod'

export const GITHUB_URL = 'https://github.com/ffffyin'
export const GITHUB_HANDLE = 'github.com/ffffyin'

export const QQ_NUMBER = '316606176'

// 只允许 http/https 外链，避免 file://、javascript: 等协议被意外打开
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
