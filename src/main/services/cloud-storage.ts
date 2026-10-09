import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import type { CloudAuthStorage } from '@tencent-ai/workbuddy-cloud-sdk'
import { dpapiEncrypt, dpapiDecrypt } from './crypto'

// SDK 的凭据存储接口是**同步**的（对齐 localStorage），而 DPAPI 加解密必须 fork
// 一次 PowerShell、是异步的。这里的做法是：内存 Map 承担同步读写，落盘走异步
// 防抖；每次写只是改内存，最多 600ms 后才真正加密写文件。
//
// 这样有个必须接受的取舍：进程被强杀时，最后 600ms 内的 token 变更可能没落盘。
// token 本来就是可续期/可重新登录的，代价可接受；反过来为了"绝不丢"而同步卡住
// UI 线程（DPAPI 一次 0.3~1s）才是真的得不偿失。

const FLUSH_DELAY_MS = 600

export interface CloudCodec {
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
}

const DEFAULT_CODEC: CloudCodec = { encrypt: dpapiEncrypt, decrypt: dpapiDecrypt }

export class SecureAuthStorage implements CloudAuthStorage {
  private cache = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | null = null
  // 串行化落盘：并发 flush 会互相覆盖，后写的旧快照能把刚续期的新 token 冲掉
  private tail: Promise<void> = Promise.resolve()
  private fallbackToMemory = false

  constructor(
    private readonly file: string,
    private readonly codec: CloudCodec = DEFAULT_CODEC
  ) {}

  /** 启动阶段调用一次：把上次的会话读回内存。文件不存在/损坏都当作未登录。 */
  async load(): Promise<void> {
    if (!existsSync(this.file)) return
    let raw: string
    try {
      raw = readFileSync(this.file, 'utf8')
    } catch {
      return
    }
    if (!raw.trim()) return
    try {
      const plain = await this.codec.decrypt(raw.trim())
      const obj = JSON.parse(plain) as unknown
      if (typeof obj !== 'object' || obj === null) return
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === 'string') this.cache.set(k, v)
      }
    } catch {
      // 解密失败（换了 Windows 用户、权限变了）：丢掉不可用的凭据，当未登录处理
      this.cache.clear()
    }
  }

  getItem(key: string): string | null {
    const v = this.cache.get(key)
    return v === undefined ? null : v
  }

  /**
   * 列出内存里已有的键（只读诊断，不参与 SDK 的存取路径）。
   *
   * 唯一用途：断网又冷启动时，CloudService 要靠它找出「SDK 把会话存在哪条键下」，
   * 然后把那份会话读出来告诉界面「你是谁」。不猜键名 —— 猜错就是静默失效。
   */
  keys(): string[] {
    return [...this.cache.keys()]
  }

  setItem(key: string, value: string): void {
    if (this.cache.get(key) === value) return
    this.cache.set(key, value)
    this.schedule()
  }

  removeItem(key: string): void {
    if (!this.cache.has(key)) return
    this.cache.delete(key)
    this.schedule()
  }

  /** 登录成功后立刻落一次盘：避免刚登录就被强杀导致下次还要重新登录 */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.tail = this.tail.then(() => this.write()).catch(() => undefined)
    return this.tail
  }

  /** 退出登录：清空内存并删除文件，不留残留凭据 */
  async wipe(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.cache.clear()
    this.tail = Promise.resolve()
    try {
      if (existsSync(this.file)) unlinkSync(this.file)
    } catch {
      // 删不掉也要保证内存已清空：登出的语义是不能再用，不是文件必须消失
    }
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, FLUSH_DELAY_MS)
  }

  private async write(): Promise<void> {
    if (this.fallbackToMemory) return
    const body = JSON.stringify(Object.fromEntries(this.cache))
    let cipher: string
    try {
      cipher = await this.codec.encrypt(body)
    } catch {
      // 加密不可用（无 PowerShell / 非 Windows）：退回纯内存，本次进程内仍可正常使用
      this.fallbackToMemory = true
      return
    }
    if (this.cache.size === 0) {
      try {
        if (existsSync(this.file)) unlinkSync(this.file)
      } catch {
        /* 见 wipe() */
      }
      return
    }
    writeFileSync(this.file, cipher, 'utf8')
  }
}
