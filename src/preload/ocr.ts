import { contextBridge, ipcRenderer } from 'electron'

// 隐藏 OCR 窗口的桥：主进程下发识别任务，渲染进程跑完 tesseract 后回传
export interface OcrJobMessage {
  id: number
  png: Uint8Array
  lang: string
  langPath: string
  workerPath: string
  corePath: string
}

export type OcrResultMessage =
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

contextBridge.exposeInMainWorld('ocrHost', {
  onJob: (cb: (msg: OcrJobMessage) => void): void => {
    ipcRenderer.on('ocr:job', (_event, msg) => cb(msg as OcrJobMessage))
  },
  sendResult: (msg: OcrResultMessage): void => {
    ipcRenderer.send('ocr:job-result', msg)
  }
})
