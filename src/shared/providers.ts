// AI 厂商模板（PRD 5.4：内置多家厂商模板 + 完全自定义，Key 用户填写）
export type QuotaKind = 'deepseek' | 'openrouter' | 'newapi'

export interface ProviderTemplate {
  provider: string
  name: string
  baseUrl: string
  textModels: string[]
  docsUrl?: string
  // 余额查询：quotaPath 相对 baseUrl 的路径（个别适配器会忽略 /v1），quotaKind 决定解析方式
  quotaPath?: string
  quotaKind?: QuotaKind
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    provider: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    textModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'],
    docsUrl: 'https://platform.openai.com'
  },
  {
    provider: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    textModels: ['deepseek-chat', 'deepseek-reasoner'],
    docsUrl: 'https://api-docs.deepseek.com',
    quotaPath: '/user/balance',
    quotaKind: 'deepseek'
  },
  {
    provider: 'moonshot',
    name: '月之暗面 Kimi',
    baseUrl: 'https://api.moonshot.cn/v1',
    textModels: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0905-preview'],
    docsUrl: 'https://platform.moonshot.cn'
  },
  {
    provider: 'dashscope',
    name: '阿里通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    textModels: ['qwen-turbo', 'qwen-plus', 'qwen-max'],
    docsUrl: 'https://help.aliyun.com/zh/model-studio'
  },
  {
    provider: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    textModels: ['glm-4-flash', 'glm-4-plus', 'glm-4.5'],
    docsUrl: 'https://open.bigmodel.cn/dev'
  },
  {
    provider: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    textModels: [
      'openai/gpt-4o-mini',
      'deepseek/deepseek-chat',
      'meta-llama/llama-3.3-70b-instruct'
    ],
    docsUrl: 'https://openrouter.ai/docs',
    quotaPath: '/credits',
    quotaKind: 'openrouter'
  },
  {
    provider: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    textModels: [],
    // one-api / new-api 中转站标准余额接口
    quotaPath: '/dashboard/billing/subscription',
    quotaKind: 'newapi'
  }
]

export function findProvider(provider: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((p) => p.provider === provider)
}
