import type { BrowserWindow } from 'electron'
import type { Db } from './db'
import { SettingsService } from './settings'
import { ModelConfigService } from './model-config'
import { UsageService } from './usage'
import { notify } from '../ipc'
import { pickRegion } from './region-overlay'
import { captureDisplay, captureDisplayAtCursor } from './screen-capture'
import { cropRegion, limitMaxEdge, toPngBuffer, toPngDataUrl } from './image'
import { recognizeText } from './ocr'
import { translateOcrLines, type OcrLinePair } from './translate'
import { openResultOverlay, type AnchorRect } from './result-overlay'
import { resolveGlossary } from './term-match'
import { log } from './logger'
import { LANGUAGES, TRANSLATION_STYLES, OCR_ENGINES, type AppSettings } from '../../shared/defaults'
import type { ResultData } from '../../shared/result'

export interface ScreenshotContext {
  win: BrowserWindow
  db: Db
}

let busy = false // 防重入

function directionLabel(settings: AppSettings): string {
  const src = LANGUAGES.find((l) => l.value === settings.languageSource)?.label ?? '自动检测'
  const tgt = LANGUAGES.find((l) => l.value === settings.languageTarget)?.label ?? settings.languageTarget
  return `${src} → ${tgt}`
}

function buildResultData(
  settings: AppSettings,
  engine: 'local' | 'vision',
  pairs: OcrLinePair[],
  models: ModelConfigService
): ResultData {
  const visionModel = models.getDefault()
  const canVision = !!visionModel && visionModel.vision_enabled === 1 && !!visionModel.vision_model
  return {
    directionLabel: directionLabel(settings),
    engine,
    pairs: pairs.map((p, i) => ({ id: i + 1, original: p.original, translation: p.translation })),
    styleOptions: TRANSLATION_STYLES.map((s) => ({ value: s.value, label: s.label })),
    currentStyle: settings.translationStyle,
    engineOptions: OCR_ENGINES.map((o) => ({ value: o.value, label: o.label })),
    currentEngine: engine,
    canVision
  }
}

async function run(ctx: ScreenshotContext, mode: 'region' | 'full'): Promise<void> {
  if (busy) return
  busy = true
  log('INFO', `截图翻译开始 mode=${mode}`)
  const { win, db } = ctx
  const settingsSvc = new SettingsService(db)
  const models = new ModelConfigService(db)
  const usage = new UsageService(db)

  // 图像与锚点在分支中确定
  let image = null as never as import('electron').NativeImage
  let anchor: AnchorRect
  let displayId: number

  try {
    if (mode === 'region') {
      const region = await pickRegion()
      if (!region) return // ESC 取消，静默终止
      notify(win, { type: 'loading', message: '正在抓取选区…' })
      const full = await captureDisplay(region.displayId)
      image = cropRegion(full, region)
      const f = region.scaleFactor
      anchor = {
        x: Math.round(region.rect.x * f),
        y: Math.round(region.rect.y * f),
        width: Math.round(region.rect.width * f),
        height: Math.round(region.rect.height * f)
      }
      displayId = region.displayId
    } else {
      notify(win, { type: 'loading', message: '正在抓取全屏…' })
      const cap = await captureDisplayAtCursor()
      image = cap.image
      displayId = cap.displayId
      const f = cap.scaleFactor
      anchor = {
        x: Math.round(cap.bounds.x * f),
        y: Math.round(cap.bounds.y * f),
        width: Math.round(cap.bounds.width * f),
        height: Math.round(cap.bounds.height * f)
      }
    }

    image = limitMaxEdge(image, 2000)

    const config = models.getDefault()
    if (!config) {
      notify(win, { type: 'error', message: '请先在「模型配置」中添加并选择默认模型' })
      return
    }
    const engine = (settingsSvc.get('ocrEngine') === 'vision' ? 'vision' : 'local') as
      | 'local'
      | 'vision'
    if (engine === 'vision' && (config.vision_enabled !== 1 || !config.vision_model)) {
      notify(win, {
        type: 'error',
        message: '默认模型未启用视觉能力，请到「模型配置」开启或改用本地 OCR'
      })
      return
    }

    notify(win, { type: 'loading', message: '正在识别画面文字…' })
    const png = toPngBuffer(image)
    const dataUrl = toPngDataUrl(image)
    const recognized = await recognizeText({
      engine,
      png,
      dataUrl,
      config: engine === 'vision' ? config : undefined
    })
    if (!recognized.text) {
      notify(win, { type: 'error', message: '未识别到文字，请确认选区内包含聊天文字' })
      return
    }
    log(
      'INFO',
      `识别完成 engine=${recognized.engine} lines=${recognized.lines.length} chars=${recognized.text.length}`
    )

    notify(win, { type: 'loading', message: '正在翻译…' })
    const lines = recognized.lines.length
      ? recognized.lines.map((l) => l.text)
      : recognized.text.split('\n')
    const s0 = settingsSvc.getAll()
    const terms = resolveGlossary(db, s0, recognized.text)
    const translated = await translateOcrLines({
      lines,
      config,
      settings: s0,
      terms,
      onProgress: (sec) =>
        notify(win, {
          type: 'loading',
          message: `正在翻译… 已等待 ${sec} 秒，画面文字较多时可能需要 1-3 分钟`
        })
    })
    log('INFO', `翻译完成 pairs=${translated.pairs.length}`)

    const overlay = openResultOverlay({
      anchor,
      displayId,
      onRetranslate: async (req) => {
        const s: AppSettings = {
          ...settingsSvc.getAll(),
          translationStyle: req.style,
          ocrEngine: req.engine
        }
        const rec = await recognizeText({
          engine: req.engine,
          png,
          dataUrl,
          config: req.engine === 'vision' ? config : undefined
        })
        if (!rec.text) throw new Error('未识别到文字')
        const recLines = rec.lines.length ? rec.lines.map((l) => l.text) : rec.text.split('\n')
        const reTerms = resolveGlossary(db, s, rec.text)
        const tt = await translateOcrLines({ lines: recLines, config, settings: s, terms: reTerms })
        return buildResultData(s, rec.engine, tt.pairs, models)
      }
    })
    overlay.setData(buildResultData(settingsSvc.getAll(), recognized.engine, translated.pairs, models))

    usage.log({
      configId: config.id,
      kind: 'vision-shot',
      engine: recognized.engine === 'vision' ? config.vision_model ?? 'vision' : config.text_model,
      chars: recognized.text.length,
      tokensIn: translated.tokensIn + recognized.tokensIn,
      tokensOut: translated.tokensOut
    })
    notify(win, { type: 'ok', message: '识别翻译完成' })
  } catch (err) {
    notify(win, { type: 'error', message: err instanceof Error ? err.message : '截图翻译失败' })
  } finally {
    busy = false
  }
}

// 快捷键 3：框选区域翻译
export function actionRegionScreenshot(ctx: ScreenshotContext): Promise<void> {
  return run(ctx, 'region')
}

// 快捷键 4：全屏翻译
export function actionFullscreenScreenshot(ctx: ScreenshotContext): Promise<void> {
  return run(ctx, 'full')
}
