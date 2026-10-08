import { describe, it, expect } from 'vitest'
import { FUNCTION_ACTIONS, PHRASE_SLOTS, phraseAction } from '../../src/shared/hotkeys'

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

  it('常用语槽位为 8，phraseAction 生成 Alt+N', () => {
    expect(PHRASE_SLOTS).toBe(8)
    const a = phraseAction(3)
    expect(a.actionCode).toBe('phrase_3')
    expect(a.defaultAccelerator).toBe('Alt+3')
    expect(a.label).toBe('常用语 3')
  })
})
