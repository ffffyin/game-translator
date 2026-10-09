// 作者联系方式与外链安全校验（纯逻辑，可单测）
export const AUTHOR_NAME = 'fygod'

export const GITHUB_URL = 'https://github.com/ffffyin'
export const GITHUB_HANDLE = 'github.com/ffffyin'

export const QQ_NUMBER = '316606176'

// 官网首页与更新清单地址。
// ⚠️ OFFICIAL_SITE_URL 目前是占位地址（OWNER/PLACEHOLDER 待替换为真实仓库），
// 换域名只需改这一行：清单地址会自动跟上（UPDATE_MANIFEST_URL 由它拼出）。
// 清单要求托管在支持 https 的静态地址上，返回 application/json，内容见 shared/update.ts。
export const OFFICIAL_SITE_URL = 'https://OWNER.github.io/PLACEHOLDER'
export const UPDATE_MANIFEST_URL = `${OFFICIAL_SITE_URL}/version.json`

// 这两个主页地址很长（带 spm / 短链随机串），界面上只显示简称，点击才跳转
export const BILIBILI_URL = 'https://space.bilibili.com/12945227'
export const BILIBILI_UID = '12945227'
export const DOUYIN_URL = 'https://v.douyin.com/VjbsvjE5RAQ/'

// 界面上要展示的联系方式行（顺序即展示顺序）
export interface ContactLink {
  key: string
  label: string
  /** 点击行为：'open' 用浏览器打开 url，'copy' 复制 text */
  action: 'open' | 'copy'
  url?: string
  /** 右侧展示的短文案（不显示完整网址） */
  display: string
  title: string
}

export const CONTACT_LINKS: ContactLink[] = [
  {
    key: 'github',
    label: 'GitHub',
    action: 'open',
    url: GITHUB_URL,
    display: GITHUB_HANDLE,
    title: '在浏览器中打开 GitHub 主页'
  },
  {
    key: 'bilibili',
    label: '哔哩哔哩',
    action: 'open',
    url: BILIBILI_URL,
    display: `UID ${BILIBILI_UID}`,
    title: '在浏览器中打开哔哩哔哩主页'
  },
  {
    key: 'douyin',
    label: '抖音',
    action: 'open',
    url: DOUYIN_URL,
    display: '打开主页',
    title: '在浏览器中打开抖音主页'
  },
  {
    key: 'qq',
    label: 'QQ',
    action: 'copy',
    display: QQ_NUMBER,
    title: '复制 QQ 号'
  }
]

// 只允许 http/https 外链，避免 file://、javascript: 等协议被意外打开
export function isSafeExternalUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}
