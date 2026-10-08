import type { ModelConfig } from '../../shared/model'
import { localOcr, type OcrResult } from './ocr-local'
import { visionExtract } from './ocr-vision'

export interface RecognizeInput {
  engine: 'local' | 'vision'
  png: Buffer
  dataUrl: string
  config?: ModelConfig
}

export interface RecognizeOutput extends OcrResult {
  engine: 'local' | 'vision'
  tokensIn: number
  tokensOut: number
}

// 统一文字识别入口：本地 OCR 或 AI 视觉，输出同构结果
export async function recognizeText(input: RecognizeInput): Promise<RecognizeOutput> {
  if (input.engine === 'vision') {
    if (!input.config) {
      throw new Error('AI 视觉通道需要先在「模型配置」中配置带视觉能力的默认模型')
    }
    const r = await visionExtract(input.config, input.dataUrl)
    return { ...r, engine: 'vision' }
  }
  const r = await localOcr(input.png)
  return { ...r, engine: 'local', tokensIn: 0, tokensOut: 0 }
}
