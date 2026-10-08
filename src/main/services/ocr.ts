import type { ModelConfig } from '../../shared/model'
import { canUseVision, normalizeOcrEngine, type OcrEngine } from '../../shared/defaults'
import { localOcr, type OcrResult } from './ocr-local'
import { visionExtract } from './ocr-vision'
import { log } from './logger'

export interface RecognizeInput {
  engine: OcrEngine
  png: Buffer
  dataUrl: string
  config?: ModelConfig
}

export interface RecognizeOutput extends OcrResult {
  engine: 'local' | 'vision'
  tokensIn: number
  tokensOut: number
  // 组合模式下本地识别失败、已自动降级为 AI 视觉
  degraded?: boolean
}

function runLocal(png: Buffer): Promise<RecognizeOutput> {
  return localOcr(png).then((r) => ({ ...r, engine: 'local' as const, tokensIn: 0, tokensOut: 0 }))
}

async function runVision(config: ModelConfig | undefined, dataUrl: string): Promise<RecognizeOutput> {
  if (!config) {
    throw new Error('AI 视觉通道需要先在「模型配置」中配置带视觉能力的默认模型')
  }
  const r = await visionExtract(config, dataUrl)
  return { ...r, engine: 'vision' }
}

// 组合模式的本地阶段：识别不到文字也算失败，交给上层决定是否降级
async function runLocalStrict(png: Buffer): Promise<RecognizeOutput> {
  const r = await runLocal(png)
  if (!r.text.trim()) throw new Error('本地 OCR 未识别到文字')
  return r
}

// 组合模式：本地优先；本地识别报错或识别不到文字时自动降级 AI 视觉
async function runHybrid(
  png: Buffer,
  dataUrl: string,
  config?: ModelConfig
): Promise<RecognizeOutput> {
  try {
    return await runLocalStrict(png)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (!canUseVision(config)) {
      // 没有可用的视觉通道，只能把本地失败原因抛出去
      log('WARN', `组合模式无法降级：本地识别失败（${reason}）且默认模型未开启视觉能力`)
      throw err
    }
    log('INFO', `组合模式降级：本地识别失败（${reason}），改用 AI 视觉`)
    const r = await runVision(config, dataUrl)
    return { ...r, degraded: true }
  }
}

// 统一文字识别入口：本地 OCR / AI 视觉 / 本地优先+AI 兜底，输出同构结果
export async function recognizeText(input: RecognizeInput): Promise<RecognizeOutput> {
  const engine = normalizeOcrEngine(input.engine)
  if (engine === 'vision') return runVision(input.config, input.dataUrl)
  if (engine === 'hybrid') return runHybrid(input.png, input.dataUrl, input.config)
  const r = await runLocal(input.png)
  return r
}
