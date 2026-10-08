import { createWorker, type Worker, type ImageLike } from 'tesseract.js'

interface OcrJobMessage {
  id: number
  png: Uint8Array
  lang: string
  langPath: string
  workerPath: string
  corePath: string
}

type OcrResultMessage =
  | {
      id: number
      ok: true
      result: {
        text: string
        confidence: number
        lines: Array<{ text: string; confidence: number }>
      }
    }
  | { id: number; ok: false; error: string }

declare global {
  interface Window {
    ocrHost: {
      onJob: (cb: (msg: OcrJobMessage) => void) => void
      sendResult: (msg: OcrResultMessage) => void
    }
  }
}

const appEl = document.getElementById('app')!
function status(s: string): void {
  appEl.innerHTML += `<div style="font:12px monospace">${s}</div>`
}

window.addEventListener('error', (e) => status('WINDOW ERROR ' + e.message))
window.addEventListener('unhandledrejection', (e) =>
  status('UNHANDLED REJECTION ' + String(e.reason))
)

let worker: Worker | null = null

window.ocrHost.onJob(async (msg) => {
  status('job ' + msg.id + ' lang=' + msg.lang + ' png=' + msg.png.length)
  try {
    if (!worker) {
      status('creating worker from ' + msg.langPath)
      worker = await createWorker(msg.lang, 1, {
        langPath: msg.langPath,
        gzip: false,
        cacheMethod: 'none',
        workerPath: msg.workerPath,
        corePath: msg.corePath,
        logger: (m: { status: string; progress: number }) => status('  ' + m.status + ' ' + m.progress)
      })
      status('worker ready')
    }
    status('recognizing…')
    const r = await worker.recognize(msg.png as unknown as ImageLike)
    status('recognized: ' + JSON.stringify((r.data.text ?? '').trim().slice(0, 100)))
    const lines = (r.data.lines ?? []).map((l) => ({
      text: (l.text ?? '').trim(),
      confidence: l.confidence ?? 0
    }))
    window.ocrHost.sendResult({
      id: msg.id,
      ok: true,
      result: {
        text: (r.data.text ?? '').trim(),
        confidence: r.data.confidence ?? 0,
        lines
      }
    })
    status('sent')
  } catch (e) {
    status('ERROR ' + (e instanceof Error ? e.message : String(e)))
    window.ocrHost.sendResult({
      id: msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e)
    })
  }
})

status('booted')
