import { describe, it, expect } from 'vitest'
import { dpapiEncrypt, dpapiDecrypt } from '../../src/main/services/crypto'

describe('DPAPI 加密服务', () => {
  it('中文与特殊字符加密后可还原', async () => {
    const plain = '你好世界 sk-abc123 !@#$%^&*()'
    const enc = await dpapiEncrypt(plain)
    expect(enc).not.toBe(plain)
    expect(enc.length).toBeGreaterThan(0)
    expect(await dpapiDecrypt(enc)).toBe(plain)
  })

  it('空字符串可往返', async () => {
    const enc = await dpapiEncrypt('')
    expect(await dpapiDecrypt(enc)).toBe('')
  })

  it('解密非法密文抛错', async () => {
    const garbage = Buffer.from('not-a-real-cipher').toString('base64')
    await expect(dpapiDecrypt(garbage)).rejects.toThrow()
  })
})
