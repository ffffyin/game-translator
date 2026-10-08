import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { createWorker, type Worker } from 'tesseract.js'

// 真实离线 OCR 验证：直接用 tesseract.js + 本地 tessdata
describe('本地 OCR（tesseract 离线链路）', () => {
  let worker: Worker

  beforeAll(async () => {
    const root = join(__dirname, '../..')
    worker = await createWorker(['eng'], 1, {
      langPath: join(root, 'resources', 'tessdata'),
      gzip: false
    })
  }, 90000)

  afterAll(() => worker.terminate())

  it('识别测试图中的英文游戏短句', async () => {
    const img = readFileSync(join(__dirname, '../fixtures/ocr-sample.png'))
    const { data } = await worker.recognize(img)
    const text = (data.text ?? '').toLowerCase()
    expect(text).toContain('noob')
    expect(text).toContain('rush')
    expect(text).toContain('eco')
    expect((data.lines ?? []).length).toBeGreaterThanOrEqual(2)
  }, 30000)
})
