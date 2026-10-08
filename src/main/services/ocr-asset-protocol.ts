import { protocol } from 'electron'
import { promises as fs } from 'fs'
import path from 'path'

// 自定义协议：从本地 resources/ocr 目录提供 tesseract worker/core，
// 使渲染进程中的 OCR 完全离线可用
const SCHEME = 'ocr-asset'

export function registerOcrScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true
      }
    }
  ])
}

export function registerOcrProtocol(assetsDir: string): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const fp = path.resolve(assetsDir, name)
    if (!fp.startsWith(path.resolve(assetsDir))) {
      return new Response('forbidden', { status: 403 })
    }
    let buf: Buffer
    try {
      buf = await fs.readFile(fp)
    } catch {
      return new Response('not found', { status: 404 })
    }
    const mime = name.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : name.endsWith('.wasm')
        ? 'application/wasm'
        : 'application/octet-stream'
    return new Response(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      {
        headers: {
          'Content-Type': mime,
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  })
}
