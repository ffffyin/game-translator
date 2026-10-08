import { recognizeViaRenderer, closeOcrWindows, type RendererOcrResult } from './ocr-worker-window'

export interface OcrLine {
  text: string
  confidence: number
  bbox: { x0: number; y0: number; x1: number; y1: number } | null
}

export interface OcrResult {
  text: string
  confidence: number
  lines: OcrLine[]
}

// 两个单语结果择优：有效字符数 × 平均置信度
function pickBest(results: RendererOcrResult[]): RendererOcrResult {
  let best = results[0]
  let bestScore = -1
  for (const r of results) {
    const score = r.text.replace(/\s/g, '').length * Math.max(r.confidence, 1)
    if (score > bestScore) {
      bestScore = score
      best = r
    }
  }
  return best
}

// 对 PNG Buffer 做本地 OCR：eng / chi_sim 各在独立隐藏窗口识别，择优合并
export async function localOcr(png: Buffer): Promise<OcrResult> {
  const recognized: RendererOcrResult[] = []
  for (const code of ['eng', 'chi_sim']) {
    recognized.push(await recognizeViaRenderer(png, code))
  }
  const winner = pickBest(recognized)
  const lines: OcrLine[] = winner.lines
    .map((l) => ({ text: l.text, confidence: l.confidence, bbox: null }))
    .filter((l) => l.text)
  return { text: winner.text, confidence: winner.confidence, lines }
}

export function terminateLocalOcr(): void {
  closeOcrWindows()
}
