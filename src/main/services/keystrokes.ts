import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const PRELUDE = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$ws=New-Object -ComObject WScript.Shell
`

const READ_ALL_SCRIPT =
  PRELUDE +
  `
Start-Sleep -Milliseconds 120
$ws.SendKeys('^a'); Start-Sleep -Milliseconds 90
$ws.SendKeys('^c'); Start-Sleep -Milliseconds 160
$c=Get-Clipboard -Raw
if($c -eq $null){$c=''}
[Console]::Out.Write($c)
`

function pasteScript(text: string): string {
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  return (
    PRELUDE +
    `
$t=[System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))
Set-Clipboard -Value $t
Start-Sleep -Milliseconds 90
$ws.SendKeys('^v')
`
  )
}

const ENTER_SCRIPT =
  PRELUDE +
  `
Start-Sleep -Milliseconds 120
$ws.SendKeys('~')
`

const SELECT_ALL_SCRIPT =
  PRELUDE +
  `
Start-Sleep -Milliseconds 120
$ws.SendKeys('^a')
`

function encodedCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

async function runScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand(script)],
    { maxBuffer: 4 * 1024 * 1024, windowsHide: true, timeout: 20000 }
  )
  return stdout
}

// 全选当前窗口文本并复制，返回复制到的内容
export async function readSelectedText(): Promise<string> {
  const out = await runScript(READ_ALL_SCRIPT)
  return out.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
}

// 把文本放入剪贴板并在当前窗口粘贴
export async function pasteText(text: string): Promise<void> {
  await runScript(pasteScript(text))
}

// 全选当前窗口文本（用于粘贴替换前重新选中占位文本）
export async function selectAllText(): Promise<void> {
  await runScript(SELECT_ALL_SCRIPT)
}

export async function pressEnter(): Promise<void> {
  await runScript(ENTER_SCRIPT)
}
