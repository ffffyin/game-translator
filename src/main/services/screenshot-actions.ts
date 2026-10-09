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
import {
  LANGUAGES,
  TRANSLATION_STYLES,
  OCR_ENGINES,
  canUseVision,
  normalizeOcrEngine,
  type AppSettings
} from '../../shared/defaults'
import type { OptionItem, ResultData } from '../../shared/result'

export interface ScreenshotContext {
  win: BrowserWindow
  db: Db
}

let busy = false // 防重入

/** 悬浮窗宽度只有 430px，方向下拉用短标签，长文案会把控件挤换行 */
const SHORT_LANGUAGE_NAMES: Record<string, string> = {
  auto: '自动',
  'zh-CN': '中',
  en: '英',
  ja: '日',
  fr: '法'
}

function shortLang(code: string): string {
  return SHORT_LANGUAGE_NAMES[code] ?? code
}

/** 方向值的唯一格式：`"源|目标"`。主进程与渲染层都按这个拆。 */
export function encodeDirection(source: string, target: string): string {
  return `${source}|${target}`
}

export function decodeDirection(direction: string): { source: string; target: string } | null {
  const i = direction.indexOf('|')
  if (i <= 0 || i === direction.length - 1) return null
  const source = direction.slice(0, i)
  const target = direction.slice(i + 1)
  const known = LANGUAGES.some((l) => l.value === source)
  const knownTarget = LANGUAGES.some((l) => l.value === target && l.value !== 'auto')
  if (!known || !knownTarget) return null
  return { source, target }
}

/** 预设的常用画面方向组合，覆盖「看外文」与「写外文」两类主要场景 */
const DIRECTION_PRESETS: Array<[string, string]> = [
  ['auto', 'zh-CN'],
  ['en', 'zh-CN'],
  ['zh-CN', 'en'],
  ['ja', 'zh-CN'],
  ['zh-CN', 'ja'],
  ['fr', 'zh-CN'],
  ['zh-CN', 'fr']
]

/**
 * 构造悬浮窗的方向下拉。
 *
 * 当前方向必须出现在列表里，否则下拉会选不中当前值（显示成空白）。
 * 用户设的组合不在预设中时，把它插到最前面。
 */
function directionOptions(settings: AppSettings): OptionItem[] {
  const current = encodeDirection(settings.screenSource, settings.screenTarget)
  const list: OptionItem[] = DIRECTION_PRESETS.map(([s, t]) => ({
    value: encodeDirection(s, t),
    label: `${shortLang(s)} → ${shortLang(t)}`
  }))
  if (!list.some((o) => o.value === current)) {
    const src = LANGUAGES.find((l) => l.value === settings.screenSource)?.label ?? settings.screenSource
    const tgt = LANGUAGES.find((l) => l.value === settings.screenTarget)?.label ?? settings.screenTarget
    list.unshift({ value: current, label: `${src} → ${tgt}` })
  }
  return list
}

/**
 * 把画面方向映射进 settings，供 prompt 构建消费。不落库、不改原 settings。
 *
 * 翻译方向只体现在 prompt 文案里（见 translate-prompt.ts），
 * OCR 引擎完全不看它 —— 所以这里只需给下游一个「effective settings」。
 */
function screenSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    languageSource: settings.screenSource,
    languageTarget: settings.screenTarget
  }
}

function directionLabel(settings: AppSettings): string {
  const s = screenSettings(settings)
  const src = LANGUAGES.find((l) => l.value === s.languageSource)?.label ?? '自动检测'
  const tgt = LANGUAGES.find((l) => l.value === s.languageTarget)?.label ?? s.languageTarget
  return `${src} → ${tgt}`
}

function buildResultData(
  settings: AppSettings,
  engine: 'local' | 'vision',
  pairs: OcrLinePair[],
  models: ModelConfigService,
  degraded = false
): ResultData {
  const visionModel = models.getDefault()
  const canVision = !!visionModel && visionModel.vision_enabled === 1 && !!visionModel.vision_model
  const s = screenSettings(settings)
  return {
    directionLabel: directionLabel(settings),
    engine,
    pairs: pairs.map((p, i) => ({ id: i + 1, original: p.original, translation: p.translation })),
    styleOptions: TRANSLATION_STYLES.map((s) => ({ value: s.value, label: s.label })),
    currentStyle: s.translationStyle,
    engineOptions: OCR_ENGINES.map((o) => ({ value: o.value, label: o.label })),
    currentEngine: engine,
    canVision,
    degraded,
    directionOptions: directionOptions(settings),
    currentDirection: encodeDirection(settings.screenSource, settings.screenTarget)
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
    const engine = normalizeOcrEngine(settingsSvc.get('ocrEngine'))
    // 只有「纯 AI 视觉」才强制要求视觉能力；组合模式没有视觉通道时退化为本地
    if (engine === 'vision' && !canUseVision(config)) {
      notify(win, {
        type: 'error',
        message: '默认模型未启用视觉能力，请到「模型配置」开启或改用本地 OCR'
      })
      return
    }

    notify(win, {
      type: 'loading',
      message: engine === 'hybrid' ? '正在识别画面文字（本地优先）…' : '正在识别画面文字…'
    })
    const png = toPngBuffer(image)
    const dataUrl = toPngDataUrl(image)
    const recognized = await recognizeText({
      engine,
      png,
      dataUrl,
      config
    })
    if (!recognized.text) {
      notify(win, { type: 'error', message: '未识别到文字，请确认选区内包含聊天文字' })
      return
    }
    log(
      'INFO',
      `识别完成 engine=${recognized.engine}${recognized.degraded ? '(本地失败降级)' : ''} lines=${recognized.lines.length} chars=${recognized.text.length}`
    )
    if (recognized.degraded) {
      notify(win, { type: 'info', message: '本地识别未取到文字，已改用 AI 视觉' })
    }

    notify(win, { type: 'loading', message: '正在翻译…' })
    const lines = recognized.lines.length
      ? recognized.lines.map((l) => l.text)
      : recognized.text.split('\n')
    const s0 = settingsSvc.getAll()
    const scr = screenSettings(s0)
    const terms = resolveGlossary(db, scr, recognized.text)
    const translated = await translateOcrLines({
      lines,
      config,
      settings: scr,
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
        // 方向优先用悬浮窗下拉里的选择，拆不开（空串/脏值）就沿用设置里的画面方向
        const dir = decodeDirection(req.direction)
        const s: AppSettings = {
          ...settingsSvc.getAll(),
          translationStyle: req.style,
          ocrEngine: req.engine,
          screenSource: dir?.source ?? settingsSvc.get('screenSource'),
          screenTarget: dir?.target ?? settingsSvc.get('screenTarget')
        }
        const rec = await recognizeText({
          engine: req.engine,
          png,
          dataUrl,
          config
        })
        if (!rec.text) throw new Error('未识别到文字')
        const recLines = rec.lines.length ? rec.lines.map((l) => l.text) : rec.text.split('\n')
        const scr = screenSettings(s)
        const reTerms = resolveGlossary(db, scr, rec.text)
        const tt = await translateOcrLines({ lines: recLines, config, settings: scr, terms: reTerms })
        return buildResultData(s, rec.engine, tt.pairs, models, !!rec.degraded)
      },
      // 下拉里改方向要记住：写回设置，下次截图翻译直接生效
      onSetDirection: async (direction) => {
        const dir = decodeDirection(direction)
        if (!dir) return
        settingsSvc.set('screenSource', dir.source)
        settingsSvc.set('screenTarget', dir.target)
      }
    })
    overlay.setData(
      buildResultData(
        settingsSvc.getAll(),
        recognized.engine,
        translated.pairs,
        models,
        !!recognized.degraded
      )
    )

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
