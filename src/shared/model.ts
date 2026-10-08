// 模型配置数据结构（对应 model_configs 表）
export interface ModelConfig {
  id: number
  name: string
  provider: string
  base_url: string
  api_key_enc: string | null
  text_model: string
  vision_enabled: number
  vision_model: string | null
  params_json: string | null
  is_default: number
  created_at: string
  updated_at: string
}

// 界面提交的表单数据；api_key 为空表示不修改已存 Key
export interface ModelConfigInput {
  name: string
  provider: string
  base_url: string
  api_key?: string
  text_model: string
  vision_enabled?: number
  vision_model?: string
  params_json?: string
}

// 列表/界面展示（不含密文）
export interface ModelConfigView {
  id: number
  name: string
  provider: string
  base_url: string
  hasKey: boolean
  text_model: string
  vision_enabled: number
  vision_model: string | null
  params_json: string | null
  is_default: number
}
