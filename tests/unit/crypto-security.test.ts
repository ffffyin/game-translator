import { describe, it, expect, vi, beforeEach } from 'vitest'

const st = vi.hoisted(() => ({
  calls: 0,
  lastArgs: [] as string[],
  lastScript: ''
}))

vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events')
  return {
    spawn: (_cmd: string, args: string[]) => {
      st.calls += 1
      st.lastArgs = args
      const child = new EventEmitter() as unknown as {
        stdout: EventEmitter
        stderr: EventEmitter
        stdin: { end: (s: string) => void }
        kill: () => void
      }
      const stdout = new EventEmitter()
      const stderr = new EventEmitter()
      Object.assign(child, {
        stdout,
        stderr,
        kill: () => undefined,
        stdin: {
          end: (script: string) => {
            st.lastScript = script
            setImmediate(() => {
              // Unprotect 返回明文 KEY，Protect 返回密文 ENC
              const payload = script.includes('Unprotect') ? 'KEY' : 'ENC'
              stdout.emit('data', Buffer.from(Buffer.from(payload).toString('base64')))
              child.emit('close', 0)
            })
          }
        }
      })
      return child
    }
  }
})

import { dpapiDecrypt, dpapiEncrypt, clearDpapiCache } from '../../src/main/services/crypto'

beforeEach(() => {
  st.calls = 0
  st.lastArgs = []
  st.lastScript = ''
  clearDpapiCache()
})

describe('DPAPI 调用方式安全与缓存', () => {
  it('脚本经 stdin 传入，命令行参数不含任何数据', async () => {
    await dpapiDecrypt('AAAA')
    expect(st.lastArgs).toEqual(['-NoProfile', '-NonInteractive', '-Command', '-'])
    expect(st.lastArgs.join(' ')).not.toContain('AAAA')
    expect(st.lastScript).toContain('AAAA')
  })

  it('同一密文重复解密只调用一次 powershell', async () => {
    expect(await dpapiDecrypt('CIPHER')).toBe('KEY')
    expect(await dpapiDecrypt('CIPHER')).toBe('KEY')
    expect(st.calls).toBe(1)
  })

  it('不同密文各自解密；clearDpapiCache 后重新调用', async () => {
    await dpapiDecrypt('A')
    await dpapiDecrypt('B')
    expect(st.calls).toBe(2)
    await dpapiDecrypt('A')
    expect(st.calls).toBe(2)
    clearDpapiCache()
    await dpapiDecrypt('A')
    expect(st.calls).toBe(3)
  })

  it('加密使用 Protect 分支', async () => {
    await dpapiEncrypt('plain')
    expect(st.lastScript).toContain('Protect')
  })
})
