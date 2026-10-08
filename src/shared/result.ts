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
  engine: 'local' | 'vision' // 本次实际使用的通道
  pairs: ResultPair[]
  styleOptions: OptionItem[]
  currentStyle: string
  engineOptions: OptionItem[]
  currentEngine: 'local' | 'vision' | 'hybrid'
  canVision: boolean
  degraded?: boolean // 组合模式下本地识别失败、已自动改用 AI 视觉
}

export interface RetranslateRequest {
  engine: 'local' | 'vision' | 'hybrid'
  style: string
}
