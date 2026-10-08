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
    const base = path.resolve(assetsDir)
    const fp = path.resolve(base, name)
    // 必须落在 base 目录内：只比较前缀会让 .../resources-secret 这类同级目录被放行
    if (fp !== base && !fp.startsWith(base + path.sep)) {
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
          // OCR worker 页面是 file:// 来源（origin 为 null），跨域取 wasm 需要放开通配；
          // 该协议只暴露 resources/ocr 下的公开静态资源，配合上面的目录内校验
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  })
}
