export interface ResultPair {
  id: number
  original: string
  translation: string
}

export interface OptionItem {
  value: string
  label: string
}

export interface ResultData {
  directionLabel: string // 例如 “自动检测 → 中文（简体）”
  engine: 'local' | 'vision'
  pairs: ResultPair[]
  styleOptions: OptionItem[]
  currentStyle: string
  engineOptions: OptionItem[]
  currentEngine: 'local' | 'vision'
  canVision: boolean
}

export interface RetranslateRequest {
  engine: 'local' | 'vision'
  style: string
}
