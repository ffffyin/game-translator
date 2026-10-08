import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  markDevDataDir,
  wipeDatabaseFiles,
  ensureCleanInstallData,
  DB_FILE_NAMES
} from '../../src/main/services/install-guard'
import { DEV_MARKER_FILE } from '../../src/shared/data-dir'

let root = ''

function seedDatabase(): void {
  for (const f of DB_FILE_NAMES) writeFileSync(join(root, f), 'user-data', 'utf8')
  mkdirSync(join(root, 'backups'), { recursive: true })
  writeFileSync(join(root, 'backups', 'translator-2026-10-08.db'), 'backup', 'utf8')
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'gt-guard-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('安装态数据守卫', () => {
  it('开发态打标记：创建标记文件且内容带版本，重复调用不覆盖', () => {
    const marker = markDevDataDir(root, '1.0.0')
    expect(existsSync(marker)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toContain('1.0.0')

    markDevDataDir(root, '9.9.9')
    expect(readFileSync(marker, 'utf8')).toContain('1.0.0')
    expect(readFileSync(marker, 'utf8')).not.toContain('9.9.9')
  })

  it('wipeDatabaseFiles 清掉主库与 WAL/SHM，保留备份', () => {
    seedDatabase()
    const removed = wipeDatabaseFiles(root)
    expect(removed.sort()).toEqual([...DB_FILE_NAMES].sort())
    for (const f of DB_FILE_NAMES) expect(existsSync(join(root, f))).toBe(false)
    expect(existsSync(join(root, 'backups', 'translator-2026-10-08.db'))).toBe(true)
  })

  it('正式版遇到开发态标记：清空数据并移除标记，返回 true', () => {
    seedDatabase()
    markDevDataDir(root, '1.0.0')

    expect(ensureCleanInstallData(root, true)).toBe(true)
    for (const f of DB_FILE_NAMES) expect(existsSync(join(root, f))).toBe(false)
    expect(existsSync(join(root, DEV_MARKER_FILE))).toBe(false)
    // 备份保留，用户仍可还原
    expect(existsSync(join(root, 'backups', 'translator-2026-10-08.db'))).toBe(true)
  })

  it('正式版没有开发态标记：不动任何数据（升级不丢配置）', () => {
    seedDatabase()
    expect(ensureCleanInstallData(root, true)).toBe(false)
    expect(readFileSync(join(root, 'translator.db'), 'utf8')).toBe('user-data')
  })

  it('开发态即使有标记也不清空', () => {
    seedDatabase()
    markDevDataDir(root, '1.0.0')
    expect(ensureCleanInstallData(root, false)).toBe(false)
    expect(readFileSync(join(root, 'translator.db'), 'utf8')).toBe('user-data')
  })
})
