import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const ref = vi.hoisted(() => ({
  handler: null as null | ((req: { url: string }) => Promise<Response>)
}))

vi.mock('electron', () => ({
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: (_scheme: string, h: (req: { url: string }) => Promise<Response>) => {
      ref.handler = h
    }
  }
}))

import { registerOcrProtocol } from '../../src/main/services/ocr-asset-protocol'

let root: string
let assetsDir: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'gt-protocol-'))
  assetsDir = join(root, 'resources', 'ocr')
  mkdirSync(assetsDir, { recursive: true })
  writeFileSync(join(assetsDir, 'worker.min.js'), 'console.log(1)')
  mkdirSync(join(root, 'resources', 'ocr-secret'), { recursive: true })
  writeFileSync(join(root, 'resources', 'ocr-secret', 'secret.txt'), 'top secret')
  registerOcrProtocol(assetsDir)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const get = (name: string): Promise<Response> =>
  ref.handler!({ url: `ocr-asset://localhost/${name}` })

describe('ocr-asset 协议目录穿越防护', () => {
  it('正常读取协议目录下的资源', async () => {
    const res = await get('worker.min.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('javascript')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('拒绝编码后的 ../ 逃逸到上级目录', async () => {
    // URL 会把明文 ../ 折叠掉，真实攻击会用 %2e%2e%2f（解码后才变成 ../）
    const res = await get('%2e%2e%2focr-secret%2fsecret.txt')
    expect(res.status).toBe(403)
  })

  it('拒绝只满足前缀匹配的兄弟目录（resources/ocr-secret）', async () => {
    // 旧实现只判断 startsWith('.../resources/ocr')，会把 ocr-secret 放行
    const res = await get('%2e%2e%2focr-secret%2fsecret.txt')
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('top secret')
  })

  it('明文 ../ 被 URL 规范化后同样读不到目录外内容', async () => {
    const res = await get('../ocr-secret/secret.txt')
    expect(res.status).not.toBe(200)
    expect(await res.text()).not.toContain('top secret')
  })

  it('不存在的文件返回 404', async () => {
    expect((await get('nope.js')).status).toBe(404)
  })
})
