import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { load } from 'js-yaml'

const cfg = load(readFileSync('electron-builder.yml', 'utf8')) as {
  files: string[]
  nsis: Record<string, unknown>
}

describe('打包范围（安装包不得携带任何本机数据与开发文件）', () => {
  it('files 全部是排除规则，没有反向把数据打进去的包含规则', () => {
    expect(cfg.files.length).toBeGreaterThan(0)
    for (const p of cfg.files) expect(p.startsWith('!')).toBe(true)
  })

  it('显式排除所有形态的数据库与开发态标记', () => {
    for (const need of [
      '!**/*.db',
      '!**/*.db-wal',
      '!**/*.db-shm',
      '!**/*.log',
      '!**/.dev-build',
      '!**/settings.local.json',
      '!**/*.sqlite*'
    ]) {
      expect(cfg.files).toContain(need)
    }
  })

  it('显式排除开发文件（覆盖率、脚本、类型配置、根目录重复的 OCR 数据）', () => {
    for (const need of [
      '!src/*',
      '!tests/*',
      '!coverage/*',
      '!scripts/*',
      '!tsconfig*.json',
      '!*.tsbuildinfo',
      '!vitest.config.{js,ts,mjs,cjs}',
      '!eng.traineddata'
    ]) {
      expect(cfg.files).toContain(need)
    }
  })

  it('卸载保留数据目录（PRD 7.1）且安装包不删除用户数据', () => {
    expect(cfg.nsis.deleteAppDataOnUninstall).toBe(false)
  })
})
