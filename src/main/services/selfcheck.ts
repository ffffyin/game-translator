import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { captureDisplayAtCursor, captureDisplay } from './screen-capture'
import { localOcr } from './ocr-local'
import { pickRegion } from './region-overlay'
import { cropRegion } from './image'
import { openResultOverlay, type ResultOverlayHandle } from './result-overlay'
import { TRANSLATION_STYLES, OCR_ENGINES } from '../../shared/defaults'
import type { ResultData } from '../../shared/result'

// 自检 1：真实抓取当前显示器 → 中心裁剪 → 本地 OCR，产物落盘
export async function runCaptureSelfcheck(root: string): Promise<string> {
  const exportsDir = join(root, 'exports')
  mkdirSync(exportsDir, { recursive: true })

  const { image, displayId, scaleFactor } = await captureDisplayAtCursor()
  const fullPath = join(exportsDir, 'selfcheck-full.png')
  writeFileSync(fullPath, image.toPNG())

  const size = image.getSize()
  const cw = Math.min(800, size.width)
  const ch = Math.min(400, size.height)
  const crop = image.crop({
    x: Math.round(size.width / 2 - cw / 2),
    y: Math.round(size.height / 2 - ch / 2),
    width: cw,
    height: ch
  })
  const cropPath = join(exportsDir, 'selfcheck-crop.png')
  writeFileSync(cropPath, crop.toPNG())

  const ocr = await localOcr(crop.toPNG())

  const report = [
    'displayId=' + displayId,
    'scaleFactor=' + scaleFactor,
    'fullSize=' + size.width + 'x' + size.height,
    'confidence=' + ocr.confidence,
    'lines=' + ocr.lines.length,
    '--- text ---',
    ocr.text
  ].join('\n')
  writeFileSync(join(exportsDir, 'selfcheck-report.txt'), report, 'utf8')
  return report
}

// 自检 2：用样例数据打开译文悬浮窗，供视觉核对
export function runOverlaySelfcheck(): ResultOverlayHandle {
  const data: ResultData = {
    directionLabel: '自动检测（检测外语） → 中文（简体）',
    engine: 'local',
    pairs: [
      { id: 1, original: 'gg noob team mid', translation: '打得不错，中路有对方菜鸟' },
      { id: 2, original: 'rush B eco save', translation: '快打 B，经济局先保枪' },
      { id: 3, original: 'mia mid ss', translation: '中路消失，可能有游走' }
    ],
    styleOptions: TRANSLATION_STYLES.map((s) => ({ value: s.value, label: s.label })),
    currentStyle: 'auto',
    engineOptions: OCR_ENGINES.map((o) => ({ value: o.value, label: o.label })),
    currentEngine: 'local',
    canVision: false
  }
  const anchor = { x: 200, y: 150, width: 700, height: 400 }
  const overlay = openResultOverlay({
    anchor,
    displayId: getPrimaryDisplayId(),
    onRetranslate: async () => data
  })
  overlay.setData(data)
  return overlay
}

function getPrimaryDisplayId(): number {
  const { screen } = require('electron')
  return screen.getPrimaryDisplay().id
}

// 自检 3：框选区域（需人工/模拟拖拽）→ 抓取裁剪 → 本地 OCR，产物落盘
export async function runRegionSelfcheck(root: string): Promise<string> {
  const exportsDir = join(root, 'exports')
  mkdirSync(exportsDir, { recursive: true })

  const region = await pickRegion()
  if (!region) return 'region-cancelled'

  const full = await captureDisplay(region.displayId)
  const crop = cropRegion(full, region)
  writeFileSync(join(exportsDir, 'selfcheck-region.png'), crop.toPNG())

  const ocr = await localOcr(crop.toPNG())
  const report = [
    'displayId=' + region.displayId,
    'scaleFactor=' + region.scaleFactor,
    'rect=' + JSON.stringify(region.rect),
    'confidence=' + ocr.confidence,
    'lines=' + ocr.lines.length,
    '--- text ---',
    ocr.text
  ].join('\n')
  writeFileSync(join(exportsDir, 'selfcheck-region-report.txt'), report, 'utf8')
  return report
}
