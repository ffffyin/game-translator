import { describe, it, expect } from 'vitest'
import { FUNCTION_ACTIONS, PHRASE_SLOTS, phraseAction, findAction } from '../../src/shared/hotkeys'

describe('快捷键动作定义', () => {
  it('四个功能动作与默认组合键', () => {
    expect(FUNCTION_ACTIONS.map((a) => a.actionCode)).toEqual([
      'translate_replace',
      'translate_clipboard',
      'capture_region',
      'capture_fullscreen'
    ])
    expect(FUNCTION_ACTIONS[0].defaultAccelerator).toBe('Ctrl+Alt+1')
  })

  it('动作名称与说明文案按设计稿提供（界面快捷键卡直接使用）', () => {
    expect(FUNCTION_ACTIONS.map((a) => a.label)).toEqual([
      '全选翻译并自动替换',
      '全选翻译 · 进入剪贴板',
      '截图区域翻译',
      '截图全屏翻译'
    ])
    expect(FUNCTION_ACTIONS.map((a) => a.desc)).toEqual([
      '取当前窗口全部文字，译文直接替换原文',
      '原文不动，译文复制到剪贴板',
      '框选屏幕区域，悬浮窗显示译文',
      '抓取整个屏幕并翻译'
    ])
  })

  it('findAction 按动作码取回定义', () => {
    expect(findAction('capture_fullscreen')?.label).toBe('截图全屏翻译')
    expect(findAction('nope')).toBeUndefined()
  })

  it('常用语槽位为 8，phraseAction 生成 Alt+N', () => {
    expect(PHRASE_SLOTS).toBe(8)
    const a = phraseAction(3)
    expect(a.actionCode).toBe('phrase_3')
    expect(a.defaultAccelerator).toBe('Alt+3')
    expect(a.label).toBe('常用语 3')
  })
})
