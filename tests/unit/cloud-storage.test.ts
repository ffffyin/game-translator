import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { SecureAuthStorage, type CloudCodec } from '../../src/main/services/cloud-storage'

// 用可逆的假加密替代 DPAPI：单测关心的是「内存 ↔ 文件」的搬运与容错，
// 真 DPAPI 的往返由 crypto.test.ts 覆盖。
const fake: CloudCodec = {
  encrypt: async (plain) => Buffer.from(plain, 'utf8').toString('base64'),
  decrypt: async (cipher) => Buffer.from(cipher, 'base64').toString('utf8')
}

const boom: CloudCodec = {
  encrypt: async () => {
    throw new Error('no crypto')
  },
  decrypt: async () => {
    throw new Error('no crypto')
  }
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gt-cloudstore-'))
  file = join(dir, 'cloud-session.enc')
})

afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 临时目录清理失败不影响用例结论 */
  }
})

describe('云端凭据存储', () => {
  it('读写是同步的，落盘是异步的', () => {
    const s = new SecureAuthStorage(file, fake)
    s.setItem('k', 'v')
    expect(s.getItem('k')).toBe('v')
    expect(s.getItem('missing')).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('flush 后能被新的实例读回（重启软件仍保持登录）', async () => {
    const a = new SecureAuthStorage(file, fake)
    a.setItem('access', 'token-1')
    a.setItem('refresh', 'wbrt_x')
    await a.flush()

    const b = new SecureAuthStorage(file, fake)
    await b.load()
    expect(b.getItem('access')).toBe('token-1')
    expect(b.getItem('refresh')).toBe('wbrt_x')
  })

  it('落盘内容是密文，明文 token 不出现在文件里', async () => {
    const a = new SecureAuthStorage(file, fake)
    a.setItem('access', 'super-secret-token')
    await a.flush()
    const raw = readFileSync(file, 'utf8')
    expect(raw).not.toContain('super-secret-token')
    expect(Buffer.from(raw, 'base64').toString('utf8')).toContain('super-secret-token')
  })

  it('removeItem 也会落盘，不会残留已删除的凭据', async () => {
    const a = new SecureAuthStorage(file, fake)
    a.setItem('a', '1')
    a.setItem('b', '2')
    await a.flush()
    a.removeItem('a')
    await a.flush()

    const b = new SecureAuthStorage(file, fake)
    await b.load()
    expect(b.getItem('a')).toBeNull()
    expect(b.getItem('b')).toBe('2')
  })

  it('wipe 清空内存并删除文件，登出后不留残留', async () => {
    const a = new SecureAuthStorage(file, fake)
    a.setItem('a', '1')
    await a.flush()
    expect(existsSync(file)).toBe(true)
    await a.wipe()
    expect(a.getItem('a')).toBeNull()
    expect(existsSync(file)).toBe(false)
  })

  it('文件损坏时按未登录处理，不抛异常', async () => {
    writeFileSync(file, 'not-a-cipher', 'utf8')
    const s = new SecureAuthStorage(file, fake)
    await expect(s.load()).resolves.toBeUndefined()
    expect(s.getItem('anything')).toBeNull()
  })

  it('文件为空时不报错', async () => {
    writeFileSync(file, '   ', 'utf8')
    const s = new SecureAuthStorage(file, fake)
    await s.load()
    expect(s.getItem('anything')).toBeNull()
  })

  it('加解密不可用时退回内存：本进程仍可用，且不写坏文件', async () => {
    const s = new SecureAuthStorage(file, boom)
    s.setItem('k', 'v')
    await s.flush()
    expect(s.getItem('k')).toBe('v')
    expect(existsSync(file)).toBe(false)
  })

  it('缓存清空后不写空文件，直接删掉', async () => {
    const s = new SecureAuthStorage(file, fake)
    s.setItem('k', 'v')
    await s.flush()
    s.removeItem('k')
    await s.flush()
    expect(existsSync(file)).toBe(false)
  })
})
