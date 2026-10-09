// 更新包下载：把安装包拉到本机，边下边算 SHA256，供界面显示进度后一键安装。
//
// 三条硬约束（别改成别的实现）：
// 1. **必须用 Electron 的 net.request，不能用 globalThis.fetch**。Node 的 undici
//    不走系统代理，国内用户连 GitHub Releases 大概率直接失败；net 走 Chromium
//    网络栈，与软件其它网络请求共享同一套代理与证书策略。
// 2. **任何异常都不许漏到 IPC**。下载失败只是「可以重试」，不能让软件看起来崩了。
// 3. **只有下载成功的文件才会出现在目标路径上**：过程读写的是 .part 半成品，
//    成功后 rename 过去。这样「目标文件存在」就等于「完整且已校验」，
//    重开时可以安全地按大小直接复用，不用再拉一遍 132MB。
import { app, net } from 'electron'
import type { ClientRequest, IncomingMessage } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { isSafeExternalUrl } from '../../shared/links'

export interface UpdateProgress {
  received: number
  total: number
  /** 0~100 的整数；总大小未知时按已下载字节估算不了，恒为 0 */
  percent: number
}

export type UpdateDownloadResult =
  | { ok: true; path: string }
  | { ok: false; message: string; canceled?: boolean }

/** 进度推送的最小间隔：IPC 每帧都发会把渲染进程拖慢 */
export const PROGRESS_THROTTLE_MS = 200

/** 万一 URL 推不出文件名时的兜底名（仍然带 .exe，避免用户下到一堆无后缀文件） */
const FALLBACK_FILE_NAME = 'game-translator-setup.exe'

/**
 * 从下载地址推导落盘文件名。
 *
 * URL 末段是带了 %E4%B8%AD%E6%96%87 这类转义的，必须 decode 回来，
 * 否则用户下载目录里会出现一串乱码文件名；查询串要剥掉，否则文件名会是
 * `setup.exe?token=xxx` 这种在 Windows 上根本存不下来的东西。
 *
 * 推不出（根目录 / 只有斜杠）时用兜底名，绝不返回空串。
 */
export function deriveFileName(url: string): string {
  try {
    const u = new URL(url)
    const raw = u.pathname.split('/').filter(Boolean).pop()
    if (!raw) return FALLBACK_FILE_NAME
    let name = raw
    try {
      name = decodeURIComponent(raw)
    } catch {
      // 转义序列不合法（比如外层又拼了一层别的编码）：原样用，不强解码
    }
    // 只保留末段：文件名里带 / 或 \ 会被当成子目录，越写到别的地方去
    name = name.split(/[\\/]/).pop() ?? ''
    name = name.trim()
    return name || FALLBACK_FILE_NAME
  } catch {
    return FALLBACK_FILE_NAME
  }
}

/**
 * 下载百分比。总大小未知（分块传输、CDN 不给 Content-Length）时返回 0，
 * 让界面显示「未知进度」而不是假装一开始就是 0% 再卡住。
 */
export function percentOf(received: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const p = Math.floor((received / total) * 100)
  if (p < 0) return 0
  if (p > 100) return 100
  return p
}

/**
 * 进度节流判定：每收到一个 chunk 都推 IPC 会把渲染层压垮（132MB / 64KB ≈ 2000 次）。
 *
 * 满足任一条件才发：百分比动了至少 1、距上次超过 200ms、已经收满（最后一条必须发，
 * 否则界面永远停在 99%）。首帧（lastPercent < 0）一律发，否则用户要盯着 0 等 200ms。
 */
export function shouldEmitProgress(
  lastPercent: number,
  lastAtMs: number,
  percent: number,
  nowMs: number,
  finished = false
): boolean {
  if (lastPercent < 0) return true
  if (finished) return percent !== lastPercent
  if (percent - lastPercent >= 1) return true
  return nowMs - lastAtMs >= PROGRESS_THROTTLE_MS
}

/**
 * 清单给了 sha256 才校验；没给视为「不校验」。
 * 比对不看大小写 —— 清单里常见大写十六进制，这里容忍它。
 */
export function verifySha256(expected: string, actual: string): boolean {
  const want = (expected ?? '').trim()
  if (!want) return true
  return want.toLowerCase() === actual.trim().toLowerCase()
}

/** 下载目录优先用系统「下载」，取不到回落临时目录 */
export function resolveDownloadDir(): string {
  try {
    return app.getPath('downloads')
  } catch {
    return app.getPath('temp')
  }
}

/** 目标文件已存在且大小对得上 → 直接复用，不再下第二遍 */
export function isReusableFile(path: string, expectedSize: number): boolean {
  if (!existsSync(path)) return false
  if (!Number.isFinite(expectedSize) || expectedSize <= 0) return true
  try {
    return statSync(path).size === expectedSize
  } catch {
    return false
  }
}

/**
 * Electron 的 IncomingMessage 运行时实现了 Node Readable 流（所以能 pause/resume
 * 做背压），但它的类型声明没带这几个成员，这里补出来，免得每处都强转。
 */
export type UpdateResponseBody = IncomingMessage & {
  pause(): void
  resume(): void
  destroy?(): void
}

function removeQuietly(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // 删不掉也无所谓：下次复用不了就重新下载，不该因此让整个操作失败
  }
}

export interface DownloadUpdateOptions {
  url: string
  /** 清单提供的 SHA256，空串表示不校验 */
  sha256?: string
  /** 清单标注的安装包体积（字节），用于判断是否可以直接复用已下载的文件 */
  expectedSize?: number
  /** 落盘目录，默认 resolveDownloadDir() */
  dir?: string
  /** 进度回调，已按 shouldEmitProgress 节流 */
  onProgress?: (p: UpdateProgress) => void
  /** 注入自定义请求实现，供单测替换 net.request */
  requestFactory?: (url: string) => ClientRequest
}

/**
 * 下载一个更新包。
 *
 * 返回 `UpdateDownloadResult`，**不抛异常** —— IPC 层可以直接把结果透传给界面。
 * 取消时返回 `{ ok: false, canceled: true }`，半成品当场删除，不留垃圾。
 */
export class UpdateDownloader {
  private current: ClientRequest | null = null
  private canceled = false
  /** 由 pipe() 挂上的兜底结算函数，见 cancel() 注释 */
  private cancelNow: (() => void) | null = null

  /** 取消当前下载。没有正在进行的下载时什么都不做。 */
  cancel(): void {
    this.canceled = true
    try {
      this.current?.abort()
    } catch {
      // 已经结束的请求 abort 会抛，吞掉即可
    }
    // 🔴 兜底结算，这一步不能省。请求已经发出、响应还没回来时，`abort` 事件
    // 可能根本不触发（响应对象上的 aborted 监听此刻还没挂上，事件无处可去）。
    // 那时只置 `canceled` 标记，start() 就会一直挂在那儿等一个永不到来的事件：
    // 用户看到的是「点了取消，进度条停住，但窗口永远不退出去」。
    // 真正的 abort 事件晚一点到也无所谓，pipe() 里的 settled 会挡住重复结算。
    this.cancelNow?.()
  }

  get downloading(): boolean {
    return this.current !== null
  }

  async start(options: DownloadUpdateOptions): Promise<UpdateDownloadResult> {
    const { url, sha256 = '', expectedSize = 0, onProgress } = options

    if (!isSafeExternalUrl(url)) {
      return { ok: false, message: '下载地址无效，需以 http(s):// 开头' }
    }
    if (this.downloading) {
      return { ok: false, message: '已有下载正在进行' }
    }

    const dir = options.dir ?? resolveDownloadDir()
    const fileName = deriveFileName(url)
    const target = join(dir, fileName)

    // 已下载过且大小一致 → 直接复用。只有下载成功才会 rename 到 target，
    // 所以「target 存在」本身就代表那次下载是完整并通过校验的。
    if (isReusableFile(target, expectedSize)) {
      if (onProgress) {
        onProgress({ received: statSync(target).size, total: statSync(target).size, percent: 100 })
      }
      return { ok: true, path: target }
    }

    const part = `${target}.part`
    removeQuietly(part)

    this.canceled = false
    const factory = options.requestFactory ?? ((u: string) => net.request({ url: u, redirect: 'follow' }))

    try {
      const result = await this.pipe(url, part, expectedSize, onProgress, factory)
      if (!result.ok) {
        removeQuietly(part)
        return result
      }

      if (!verifySha256(sha256, result.sha256)) {
        removeQuietly(part)
        return {
          ok: false,
          message: '安装包校验失败，可能是下载过程被篡改或中断，请重试下载'
        }
      }

      renameSync(part, target)
      return { ok: true, path: target }
    } catch (err) {
      removeQuietly(part)
      if (this.canceled) return { ok: false, message: '已取消下载', canceled: true }
      return { ok: false, message: `下载失败：${err instanceof Error ? err.message : String(err)}` }
    } finally {
      this.current = null
      this.cancelNow = null
      this.canceled = false
    }
  }

  /** 把响应体写进文件并逐块喂给 SHA256，返回最终摘要 */
  private pipe(
    url: string,
    part: string,
    expectedSize: number,
    onProgress: ((p: UpdateProgress) => void) | undefined,
    factory: (url: string) => ClientRequest
  ): Promise<{ ok: true; sha256: string } | { ok: false; message: string; canceled?: boolean }> {
    return new Promise((resolve, reject) => {
      let request: ClientRequest
      try {
        request = factory(url)
      } catch (err) {
        reject(err)
        return
      }
      this.current = request

      const hash = createHash('sha256')
      const file = createWriteStream(part)
      let received = 0
      let total = expectedSize > 0 ? expectedSize : 0
      let lastPercent = -1
      let lastAtMs = 0
      let settled = false

      const emit = (percent: number, finished: boolean): void => {
        if (!onProgress) return
        if (!shouldEmitProgress(lastPercent, lastAtMs, percent, Date.now(), finished)) return
        lastPercent = percent
        lastAtMs = Date.now()
        onProgress({ received, total, percent })
      }

      const done = (r: { ok: true; sha256: string } | { ok: false; message: string; canceled?: boolean }): void => {
        if (settled) return
        settled = true
        resolve(r)
      }

      const fail = (message: string): void => {
        if (settled) return
        // 🔴 这里千万不能先置 settled。settled 是 done() 的「只结算一次」闸门，
        // 在 fail 里提前置位，紧接着调 done() 会在它的第一行 `if (settled) return`
        // 直接返回 —— resolve 永远不会被调用，start() 就这么永久挂住。
        // 症状是用户点了「取消下载」，进度条停住、窗口再也退不出去。
        // 结算标记只由 done() 负责，fail 只负责拼结果。
        this.canceled ? done({ ok: false, message, canceled: true }) : done({ ok: false, message })
      }

      // 🔴 兜底结算钩子，见 cancel() 里的注释。
      // 请求已发出、响应还没回来时，`abort` / `aborted` 事件可能永远不来（此刻
      // 还没有任何监听器挂上去），只置 `canceled` 标记会让 start() 永久挂起。
      // 所以这里主动把「立刻结算」这条路交出去：cancel() 调它即可，
      // 真正的事件晚点到也没关系，settled 会挡住重复结算。
      this.cancelNow = (): void => {
        // 🔴 必须是 destroy 不是 end。end() 只是「不再写了」，还要等缓冲区排空、
        // fd 异步关闭；destroy() 立刻把句柄掐断。Windows 上文件句柄不释放，
        // 后面 removeQuietly(part) 删不掉这个半成品（132MB 就赖在下载目录里了），
        // 而且临时目录会卡在「待删除」状态，后续任何写都直接 EPERM。
        try {
          file.destroy()
        } catch {
          // 流可能已经结束了，destroy 再调会抛，吞掉即可
        }
        fail('已取消下载')
      }

      // 文件写异常（磁盘满 / 目录不可写）必须终止整个请求，否则会挂到天荒地老
      file.on('error', (err: Error) => {
        try {
          request.abort()
        } catch {
          // 忽略
        }
        reject(err)
      })

      request.on('response', (res) => {
        const body = res as UpdateResponseBody
        const status = res.statusCode ?? 0
        if (status < 200 || status >= 300) {
          try {
            body.destroy?.()
          } catch {
            // Electron 的响应对象不一定有 destroy，忽略
          }
          try {
            request.abort()
          } catch {
            // 忽略
          }
          done({ ok: false, message: `下载失败：更新服务器返回 HTTP ${status}` })
          return
        }

        const len = Number(res.headers['content-length'] ?? 0)
        if (Number.isFinite(len) && len > 0) total = len

        body.on('data', (chunk: Buffer) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
          hash.update(buf)
          received += buf.length
          emit(percentOf(received, total), false)
          // 背压：磁盘跟不上时先暂停读，等 drain 再继续，避免整包堆在内存里
          if (!file.write(buf)) body.pause()
        })
        const onDrain = (): void => body.resume()
        file.on('drain', onDrain)

        body.on('end', () => {
          file.removeListener('drain', onDrain)
          file.end(() => {
            emit(100, true)
            done({ ok: true, sha256: hash.digest('hex') })
          })
        })
        body.on('error', (err: Error) => reject(err))
        body.on('aborted', () => fail('已取消下载'))
      })

      request.on('error', (err: Error) => reject(err))
      request.on('abort', () => fail('已取消下载'))
      request.end()
    })
  }
}
