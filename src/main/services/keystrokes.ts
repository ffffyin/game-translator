import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

const PRELUDE = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$ws=New-Object -ComObject WScript.Shell
`

// 二次试探用的哨兵：剪贴板读到它说明 Ctrl+C 没有复制到任何内容
const CLIP_SENTINEL = '__GT_NO_SELECTION__'

// 全选并复制当前窗口的选中文本。
// 关键点：先用"基准值比对"判断剪贴板是否真的更新过，避免把上一次的剪贴板内容
// 当成原文（误触快捷键时会把无关内容翻译后粘进别的窗口）；
// 若剪贴板没变化，再用哨兵复探一次，区分"没有选中内容"与"选中内容恰好等于剪贴板"。
export const READ_ALL_SCRIPT =
  PRELUDE +
  `
Start-Sleep -Milliseconds 120

function Get-ClipText {
  try { $v = Get-Clipboard -Raw } catch { $v = $null }
  if ($null -eq $v) { return '' }
  return [string]$v
}

$base = Get-ClipText
$ws.SendKeys('^a'); Start-Sleep -Milliseconds 90
$ws.SendKeys('^c')

$c = ''
for ($i = 0; $i -lt 5; $i++) {
  Start-Sleep -Milliseconds 120
  $c = Get-ClipText
  if ($c -ne '' -and $c -ne $base) { break }
}

if ($c -eq '' -or $c -eq $base) {
  $sentinel = '${CLIP_SENTINEL}'
  Set-Clipboard -Value $sentinel
  Start-Sleep -Milliseconds 90
  $ws.SendKeys('^a'); Start-Sleep -Milliseconds 90
  $ws.SendKeys('^c')
  $c = ''
  for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Milliseconds 120
    $c = Get-ClipText
    if ($c -ne '' -and $c -ne $sentinel) { break }
  }
  if ($c -eq '' -or $c -eq $sentinel) {
    # 确实没有可复制的内容：把用户原来的剪贴板内容还回去
    $c = ''
    Set-Clipboard -Value $base
  }
}

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

// 去掉 BOM 与首尾空白，统一换行
export function parseSelectedText(stdout: string): string {
  return stdout.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim()
}

// 全选当前窗口文本并复制，返回复制到的内容；没有选中任何内容时返回空串
export async function readSelectedText(): Promise<string> {
  return parseSelectedText(await runScript(READ_ALL_SCRIPT))
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
