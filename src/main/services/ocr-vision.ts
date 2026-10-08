import type { ModelConfig } from '../../shared/model'
import { createClient } from './translate'
import type { OcrLine, OcrResult } from './ocr-local'

const EXTRACT_PROMPT =
  '原样提取画面中的所有文字，按阅读顺序逐行输出，每行一条；' +
  '不要翻译、解释、补全或添加任何画面中没有的内容。如果画面中没有文字，只输出：NO_TEXT'

export interface VisionExtractResult extends OcrResult {
  tokensIn: number
  tokensOut: number
}

// 用视觉模型提取画面文字（只提取，不翻译）
export async function visionExtract(
  config: ModelConfig,
  dataUrl: string
): Promise<VisionExtractResult> {
  if (config.vision_enabled !== 1 || !config.vision_model) {
    throw new Error('该模型未配置视觉能力，请到「模型配置」启用视觉并填写视觉模型')
  }
  const client = await createClient(config)
  const completion = await client.chat.completions.create({
    model: config.vision_model,
    temperature: 0,
    messages: [
      {
        role: 'user',
        // 模型无关的多模态内容格式；部分兼容厂商类型定义较窄，这里放宽
        content: [
          { type: 'text', text: EXTRACT_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  } as never)

  const raw = completion.choices[0]?.message?.content?.trim() ?? ''
  if (!raw) throw new Error('视觉模型未返回内容')
  if (raw === 'NO_TEXT') {
    return { text: '', confidence: 100, lines: [], tokensIn: 0, tokensOut: 0 }
  }
  const lines: OcrLine[] = raw
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text) => ({ text, confidence: 100, bbox: null }))

  return {
    text: lines.map((l) => l.text).join('\n'),
    confidence: 100,
    lines,
    tokensIn: completion.usage?.prompt_tokens ?? 0,
    tokensOut: completion.usage?.completion_tokens ?? 0
  }
}
