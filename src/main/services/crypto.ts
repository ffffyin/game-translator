import { spawn } from 'child_process'

// 脚本经 stdin 传入（powershell -Command -），数据不出现在进程命令行里：
// 同机其它进程无法通过读命令行还原 API Key
function buildScript(call: 'Protect' | 'Unprotect', b64: string): string {
  return `$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.Security\n$data=[Convert]::FromBase64String('${b64}')\n$r=[Security.Cryptography.ProtectedData]::${call}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)\n[Console]::Out.Write([Convert]::ToBase64String($r))\n`
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    let timer: NodeJS.Timeout | null = null
    const done = (fn: () => void): void => {
      if (timer) clearTimeout(timer)
      fn()
    }
    timer = setTimeout(() => {
      ps.kill()
      reject(new Error('DPAPI 调用超时'))
    }, 20000)
    ps.stdout.on('data', (d) => (out += String(d)))
    ps.stderr.on('data', (d) => (err += String(d)))
    ps.on('error', (e) => done(() => reject(e)))
    ps.on('close', (code) =>
      done(() => {
        if (code === 0) resolve(out.trim())
        else reject(new Error(`DPAPI 调用失败（code=${code}）：${err.trim() || out.trim()}`))
      })
    )
    try {
      ps.stdin.end(script, 'utf8')
    } catch (e) {
      done(() => reject(e instanceof Error ? e : new Error(String(e))))
    }
  })
}

// 明文 → DPAPI 密文（base64）
export async function dpapiEncrypt(plain: string): Promise<string> {
  return runPowerShell(buildScript('Protect', Buffer.from(plain, 'utf8').toString('base64')))
}

// 解密结果短缓存：翻译/测速会反复解密同一个 key，缓存可避免每次 fork powershell（0.3~1s）
const CACHE_TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 32
const decryptCache = new Map<string, { value: string; at: number }>()

export function clearDpapiCache(): void {
  decryptCache.clear()
}

// DPAPI 密文（base64）→ 明文
export async function dpapiDecrypt(encBase64: string): Promise<string> {
  const hit = decryptCache.get(encBase64)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  const out = await runPowerShell(buildScript('Unprotect', encBase64))
  const plain = Buffer.from(out, 'base64').toString('utf8')
  if (decryptCache.size >= CACHE_MAX) {
    // 简单淘汰：丢掉最旧的一条
    const oldest = [...decryptCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) decryptCache.delete(oldest[0])
  }
  decryptCache.set(encBase64, { value: plain, at: Date.now() })
  return plain
}
