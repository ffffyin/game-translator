// 功能快捷键动作定义（PRD 3.4）
export interface HotkeyAction {
  actionCode: string
  label: string
  defaultAccelerator: string
}

export const FUNCTION_ACTIONS: HotkeyAction[] = [
  { actionCode: 'translate_replace', label: '全选翻译并自动替换', defaultAccelerator: 'Ctrl+Alt+1' },
  { actionCode: 'translate_clipboard', label: '全选翻译进剪贴板', defaultAccelerator: 'Ctrl+Alt+2' },
  { actionCode: 'capture_region', label: '截图区域悬浮翻译', defaultAccelerator: 'Ctrl+Alt+3' },
  { actionCode: 'capture_fullscreen', label: '截图全屏翻译', defaultAccelerator: 'Ctrl+Alt+4' }
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
