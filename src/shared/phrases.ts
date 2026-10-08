export interface PhraseView {
  id: number
  page_id: number | null
  slot: number
  content: string
  accelerator: string
  sort_order: number
  enabled: number
  is_custom: number
  updated_at: string
}

// 常用语分页：每页各自 8 个槽位（Alt+1~8），只有「当前页」的快捷键会生效
export interface PhrasePageView {
  id: number
  name: string
  note: string | null
  sort_order: number
  is_active: number
  is_builtin: number
  count: number
  updated_at: string
}

export interface PhrasePageInput {
  name: string
  note?: string
}
