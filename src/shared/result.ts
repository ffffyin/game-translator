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
  /** 可选方向组合，供悬浮窗下拉切换。缺省时不渲染方向下拉。 */
  directionOptions?: OptionItem[]
  /** 当前方向，格式 `"源|目标"`，如 `"en|zh-CN"` */
  currentDirection?: string
}

export interface RetranslateRequest {
  engine: 'local' | 'vision' | 'hybrid'
  style: string
  /** 方向，格式 `"源|目标"`。空串表示沿用设置里的画面方向。 */
  direction: string
}
