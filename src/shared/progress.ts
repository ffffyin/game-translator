import type { AppSettings } from './defaults'

// 语言值转简短方向标签：zh-CN → zh，en → en，auto → auto
function shortTag(value: string): string {
  if (value === 'auto') return 'auto'
  return value.split('-')[0]
}

// 生成替换翻译等待期间的进度占位文本，例如：
// 游戏翻译助手翻译中...（zh→en | 场景:dota2 | 模式:auto）
export function buildProgressPlaceholder(settings: AppSettings): string {
  const direction = `${shortTag(settings.languageSource)}→${shortTag(settings.languageTarget)}`
  return `游戏翻译助手翻译中...（${direction} | 场景:${settings.termLibrary} | 模式:${settings.translationStyle}）`
}
