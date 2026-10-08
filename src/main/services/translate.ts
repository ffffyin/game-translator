import OpenAI from 'openai'
import type { ModelConfig } from '../../shared/model'
import type { AppSettings } from '../../shared/defaults'
import { buildMessages, buildSystemPrompt, type GlossaryTerm } from './translate-prompt'
import { dpapiDecrypt } from './crypto'

export interface TranslateRequest {
  text: string
  config: ModelConfig
  settings: AppSettings
  terms?: GlossaryTerm[]
}

export interface TranslateResult {
  text: string
  tokensIn: number
  tokensOut: number
}

export async function createClient(config: ModelConfig): Promise<OpenAI> {
  const apiKey = config.api_key_enc ? await dpapiDecrypt(config.api_key_enc) : ''
  return new OpenAI({ apiKey, baseURL: config.base_url })
}

export async function translateText(req: TranslateRequest): Promise<TranslateResult> {
  const client = await createClient(req.config)
  const extra = req.config.params_json ? JSON.parse(req.config.params_json) : {}
  const completion = await client.chat.completions.create({
    model: req.config.text_model,
    messages: buildMessages({ text: req.text, settings: req.settings, terms: req.terms }),
    temperature: 0.3,
    ...extra
  })
  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error('模型未返回译文')
  return {
    text,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0
  }
}

export interface OcrLinePair {
  original: string
  translation: string
}

export interface OcrLineTranslateResult {
  pairs: OcrLinePair[]
  tokensIn: number
  tokensOut: number
}

// OCR 多行：一次请求逐行翻译，保持行数与顺序
export async function translateOcrLines(opts: {
  lines: string[]
  config: ModelConfig
  settings: AppSettings
  terms?: GlossaryTerm[]
}): Promise<OcrLineTranslateResult> {
  const { lines, config, settings, terms } = opts
  const client = await createClient(config)
  let system =
    buildSystemPrompt(settings, terms) +
    '\n用户给的是游戏画面中按顺序识别出的多行文字。请逐行翻译：' +
    '输出行数必须与输入完全一致、顺序一一对应；不要合并、拆分、新增行，也不要加行号或解释。'
  const completion = await client.chat.completions.create({
    model: config.text_model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: lines.map((l, i) => `${i + 1}. ${l}`).join('\n') }
    ]
  })
  const raw = completion.choices[0]?.message?.content ?? ''
  const outLines = raw
    .split('\n')
    .map((t) => t.replace(/^\s*\d+[.、)]\s*/, '').trim())
    .filter(Boolean)

  let pairs: OcrLinePair[]
  if (outLines.length === lines.length) {
    pairs = lines.map((original, i) => ({ original, translation: outLines[i] }))
  } else {
    // 模型未遵守行数约定：退化为整段对应，保证信息不丢
    pairs = [{ original: lines.join('\n'), translation: raw.trim() }]
  }
  return {
    pairs,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0
  }
}

// 测试连接：用 1 token 的最小请求验证 Key / 地址 / 模型
export async function testConnection(config: ModelConfig): Promise<{ ok: boolean; message: string }> {  try {
    const client = await createClient(config)
    await client.chat.completions.create({
      model: config.text_model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1
    })
    return { ok: true, message: '连接成功' }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
