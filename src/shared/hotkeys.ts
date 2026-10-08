// 功能快捷键动作定义（PRD 3.4）
export interface HotkeyAction {
  actionCode: string
  label: string
  defaultAccelerator: string
  // 界面说明文案（设计稿 4.1 主页快捷键卡）
  desc?: string
}

export const FUNCTION_ACTIONS: HotkeyAction[] = [
  {
    actionCode: 'translate_replace',
    label: '全选翻译并自动替换',
    defaultAccelerator: 'Ctrl+Alt+1',
    desc: '取当前窗口全部文字，译文直接替换原文'
  },
  {
    actionCode: 'translate_clipboard',
    label: '全选翻译 · 进入剪贴板',
    defaultAccelerator: 'Ctrl+Alt+2',
    desc: '原文不动，译文复制到剪贴板'
  },
  {
    actionCode: 'capture_region',
    label: '截图区域翻译',
    defaultAccelerator: 'Ctrl+Alt+3',
    desc: '框选屏幕区域，悬浮窗显示译文'
  },
  {
    actionCode: 'capture_fullscreen',
    label: '截图全屏翻译',
    defaultAccelerator: 'Ctrl+Alt+4',
    desc: '抓取整个屏幕并翻译'
  }
]

// 常用语固定 8 槽位，默认 Alt+1 ~ Alt+8（PRD 5.5）
export const PHRASE_SLOTS = 8

// hotkeys 表行（界面展示）
export interface HotkeyEntry {
  id: number
  action_code: string
  accelerators: string
  enabled: number
}

export function phraseAction(slot: number): HotkeyAction {
  return {
    actionCode: `phrase_${slot}`,
    label: `常用语 ${slot}`,
    defaultAccelerator: `Alt+${slot}`
  }
}

export function findAction(actionCode: string): HotkeyAction | undefined {
  return FUNCTION_ACTIONS.find((a) => a.actionCode === actionCode)
}
