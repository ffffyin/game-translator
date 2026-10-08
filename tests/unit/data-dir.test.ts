import { describe, it, expect } from 'vitest'
import {
  resolveDataDirName,
  shouldResetForCleanInstall,
  PACKAGED_DATA_DIR,
  DEV_DATA_DIR
} from '../../src/shared/data-dir'

describe('数据目录隔离（保证安装版是空白默认设置）', () => {
  it('正式版与开发版使用两个互不相同的目录名', () => {
    expect(resolveDataDirName(true)).toBe(PACKAGED_DATA_DIR)
    expect(resolveDataDirName(false)).toBe(DEV_DATA_DIR)
    expect(PACKAGED_DATA_DIR).not.toBe(DEV_DATA_DIR)
  })

  it('正式版目录名固定为 GameTranslator（兼容既有用户数据）', () => {
    expect(PACKAGED_DATA_DIR).toBe('GameTranslator')
    expect(DEV_DATA_DIR).toBe('GameTranslator-dev')
  })

  it('只有「正式版 + 开发态标记」才触发清空', () => {
    expect(shouldResetForCleanInstall(true, true)).toBe(true)
    expect(shouldResetForCleanInstall(true, false)).toBe(false)
    expect(shouldResetForCleanInstall(false, true)).toBe(false)
    expect(shouldResetForCleanInstall(false, false)).toBe(false)
  })
})
