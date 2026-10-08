import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'

export interface RendererOcrResult {
  text: string
  confidence: number
  lines: Array<{ text: string; confidence: number }>
}

interface WindowState {
  win: BrowserWindow
  ready: Promise<void>
}

const windows = new Map<string, WindowState>()
let seq = 0
const pending = new Map<
  number,
  { resolve: (r: RendererOcrResult) => void; reject: (e: Error) => void }
>()

ipcMain.on('ocr:job-result', (_event, msg) => {
  const p = pending.get(msg.id)
  if (!p) return
  pending.delete(msg.id)
  if (msg.ok) p.resolve(msg.result as RendererOcrResult)
  else p.reject(new Error(msg.error))
})

function createOcrWindow(code: string): WindowState {
  const browser = new BrowserWindow({
    show: false,
    width: 480,
    height: 360,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    title: 'ocr-' + code,
    webPreferences: {
      preload: join(__dirname, '../preload/ocr.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })
  const ready = new Promise<void>((resolve) => {
    browser.webContents.once('did-finish-load', () => resolve())
  })
  browser.loadFile(join(__dirname, '../renderer/ocr.html'))
  browser.on('closed', () => windows.delete(code))
  const state = { win: browser, ready }
  windows.set(code, state)
  return state
}

// 在独立隐藏渲染窗口中跑单语言 tesseract（每种语言一个窗口，进程隔离，
// 避开「同页面第二个 worker 创建即挂」与「组合语言初始化死锁」）
export async function recognizeViaRenderer(
  png: Buffer,
  code: string
): Promise<RendererOcrResult> {
  let state = windows.get(code)
  if (!state) state = createOcrWindow(code)
  await state.ready

  const id = ++seq
  const job = new Promise<RendererOcrResult>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })

  state.win.webContents.send('ocr:job', {
    id,
    png: new Uint8Array(png),
    lang: code,
    langPath: 'ocr-asset://localhost/tessdata',
    workerPath: 'ocr-asset://localhost/ocr/worker.min.js',
    corePath: 'ocr-asset://localhost/ocr/tesseract-core-simd-lstm.wasm.js'
  })

  const timer = setTimeout(() => {
    const p = pending.get(id)
    if (p) {
      pending.delete(id)
      p.reject(new Error('OCR 识别超时（' + code + '）'))
    }
  }, 150000)
  const result = await job
  clearTimeout(timer)
  return result
}

export function closeOcrWindows(): void {
  for (const state of windows.values()) state.win.close()
  windows.clear()
}
