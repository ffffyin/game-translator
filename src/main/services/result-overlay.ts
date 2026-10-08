import { BrowserWindow, clipboard, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { ResultData, RetranslateRequest } from '../../shared/result'

export interface AnchorRect {
  x: number // 物理像素
  y: number
  width: number
  height: number
}

export interface OpenResultArgs {
  anchor: AnchorRect // 选区物理矩形（全屏翻译时为显示器矩形）
  displayId: number
  onRetranslate: (req: RetranslateRequest) => Promise<ResultData>
}

export interface ResultOverlayHandle {
  setData: (d: ResultData) => void
  close: () => void
}

const WIN_W = 430
const WIN_H = 520

// 同一时刻只允许存在一个结果窗：打开新的前先关掉旧的，
// 否则每次截图翻译都会残留一个置顶窗口（且闭包持有整张 PNG）
let current: ResultOverlayHandle | null = null

export function closeResultOverlay(): void {
  current?.close()
  current = null
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(v, max))
}

function positionNear(anchor: AnchorRect, displayId: number): { x: number; y: number } {
  const display = screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getPrimaryDisplay()
  const f = display.scaleFactor
  const b = display.bounds
  // 显示器边界换算为物理像素，与锚点口径一致
  const bx = b.x * f
  const by = b.y * f
  const bw = b.width * f
  const bh = b.height * f
  // 悬浮窗尺寸（DIP）换算为物理用于定位
  const w = WIN_W * f
  const h = WIN_H * f

  // 优先放在选区右侧，否则左侧，再不行上方/下方
  let x = anchor.x + anchor.width + 12 * f
  if (x + w > bx + bw) x = anchor.x - w - 12 * f
  if (x < bx) x = bx + Math.min(12 * f, bw - w)
  let y = anchor.y
  if (y + h > by + bh) y = by + bh - h - 12 * f
  if (y < by) y = by + 12 * f

  return {
    x: clamp(Math.round(x / f), b.x, b.x + b.width - WIN_W),
    y: clamp(Math.round(y / f), b.y, b.y + b.height - WIN_H)
  }
}

export function openResultOverlay(args: OpenResultArgs): ResultOverlayHandle {
  if (current) current.close()
  const pos = positionNear(args.anchor, args.displayId)
  const win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: WIN_W,
    height: WIN_H,
    frame: false,
    transparent: true,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')

  let pinned = false
  let loaded = false
  let queuedData: ResultData | null = null
  const ipc = win.webContents.ipc

  const flushData = (): void => {
    if (loaded && queuedData && !win.isDestroyed()) {
      win.webContents.send('result:data', queuedData)
      queuedData = null
    }
  }
  win.webContents.on('did-finish-load', () => {
    loaded = true
    flushData()
  })

  ipc.handle('result:retranslate', async (_e, req: RetranslateRequest) => {
    try {
      const d = await args.onRetranslate(req)
      if (!win.isDestroyed()) win.webContents.send('result:data', d)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : '重新翻译失败' }
    }
  })
  ipc.on('result:setPinned', (_e, value: boolean) => {
    // 置顶锁定：窗口本身始终 screen-saver 置顶，锁定只影响失焦是否自动关闭
    pinned = value
  })
  ipc.on('result:close', () => {
    if (!win.isDestroyed()) win.close()
  })
  ipc.on('result:copy', (_e, text: string) => clipboard.writeText(text))

  // 点击窗外自动关闭，置顶锁定后保留；
  // 打开后的前 1.5 秒不启用，避免创建瞬间的焦点抖动导致秒关
  let blurArmed = false
  const armTimer = setTimeout(() => {
    blurArmed = true
  }, 1500)
  win.on('blur', () => {
    if (blurArmed && !pinned && !win.isDestroyed()) win.close()
  })
  win.on('closed', () => {
    clearTimeout(armTimer)
    if (current === handle) current = null
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('RESULT did-fail-load', code, desc, url)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('RESULT render-process-gone', JSON.stringify(details))
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'].replace(/\/$/, '') + '/result.html')
  } else {
    win.loadFile(join(__dirname, '../renderer/result.html'))
  }

  const handle: ResultOverlayHandle = {
    setData: (d) => {
      queuedData = d
      flushData()
    },
    close: () => {
      if (!win.isDestroyed()) win.close()
      if (current === handle) current = null
    }
  }
  current = handle
  return handle
}
