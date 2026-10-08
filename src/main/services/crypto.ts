import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

// base64 内联进脚本：无需 stdin（EncodedCommand 下 stdin 会阻塞），也无需额外参数
function buildScript(call: 'Protect' | 'Unprotect', b64: string): string {
  return `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
$data=[Convert]::FromBase64String('${b64}')
$r=[Security.Cryptography.ProtectedData]::${call}($data,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([Convert]::ToBase64String($r))
`
}

function encodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function runDpapi(call: 'Protect' | 'Unprotect', b64: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(buildScript(call, b64))],
    { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 20000 }
  )
  return stdout.trim()
}

// 明文 → DPAPI 密文（base64）
export async function dpapiEncrypt(plain: string): Promise<string> {
  return runDpapi('Protect', Buffer.from(plain, 'utf8').toString('base64'))
}

// DPAPI 密文（base64）→ 明文
export async function dpapiDecrypt(encBase64: string): Promise<string> {
  const outB64 = await runDpapi('Unprotect', encBase64)
  return Buffer.from(outB64, 'base64').toString('utf8')
}
