// 主进程文件日志（PRD 7.1 logs 目录）：打包后 GUI 程序无控制台，错误落盘便于排查
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

let logFile = ''

export function initLogger(root: string): void {
  const dir = join(root, 'logs')
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'main.log')
}

export function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string): void {
  if (!logFile) return
  try {
    appendFileSync(logFile, `${new Date().toISOString()} [${level}] ${msg}\n`)
  } catch {
    // 日志失败不影响主流程
  }
}

export function errToText(e: unknown): string {
  if (e instanceof Error) return `${e.message}\n${e.stack ?? ''}`
  return String(e)
}
