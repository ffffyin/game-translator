import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = vi.hoisted(() => ({
  registered: new Set<string>(),
  registerResult: true
}))

vi.mock('electron', () => ({
  globalShortcut: {
    isRegistered: (a: string) => state.registered.has(a),
    register: (a: string) => {
      if (!state.registerResult) return false
      state.registered.add(a)
      return true
    },
    unregister: (a: string) => state.registered.delete(a),
    unregisterAll: () => state.registered.clear()
  }
}))

import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { HotkeyManager } from '../../src/main/services/hotkey-manager'
import { seedDefaultPhrases } from '../../src/main/services/phrases'
import { join } from 'path'
import { tmpdir } from 'os'

const RESOURCES = join(__dirname, '..', '..', 'resources')

function setup() {
  const p = join(tmpdir(), `gt-hkph-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
  const db = new Db(p)
  applyMigrations(db)
  seedDefaultPhrases(db, RESOURCES)
  const hm = new HotkeyManager(db)
  hm.seed()
  return { db, hm }
}

const noop = (): (() => void) => () => {}

beforeEach(() => {
  state.registered.clear()
  state.registerResult = true
})

describe('常用语快捷键注册与冲突检测', () => {
  it('8 条常用语全部注册成功', () => {
    const { hm } = setup()
    const r = hm.registerPhraseHotkeys(noop)
    expect(r.registered).toBe(8)
    expect(r.failures).toEqual([])
    expect(state.registered.has('Alt+1')).toBe(true)
    expect(state.registered.has('Alt+8')).toBe(true)
  })

  it('与功能快捷键冲突时登记失败且不覆盖', () => {
    const { hm } = setup()
    // 模拟功能快捷键已占用 Alt+3
    state.registered.add('Alt+3')
    const r = hm.registerPhraseHotkeys(noop)
    expect(r.registered).toBe(7)
    expect(r.failures).toHaveLength(1)
    expect(r.failures[0].accelerator).toBe('Alt+3')
    expect(r.failures[0].reason).toContain('冲突')
  })

  it('系统拒绝注册（返回 false）时登记失败', () => {
    const { hm } = setup()
    state.registerResult = false
    const r = hm.registerPhraseHotkeys(noop)
    expect(r.registered).toBe(0)
    expect(r.failures).toHaveLength(8)
  })

  it('refresh：先解绑旧常用语键再重新注册', () => {
    const { hm } = setup()
    hm.registerPhraseHotkeys(noop)
    expect(state.registered.size).toBe(8)
    // 让 Alt+4 在重注册时被占用
    const r = hm.refreshPhraseHotkeys((p) =>
      p.accelerator === 'Alt+4' ? null : (() => {})
    )
    // Alt+4 无 handler → 跳过，其余 7 个注册
    expect(r.registered).toBe(7)
    expect(state.registered.has('Alt+4')).toBe(false)
    expect(state.registered.has('Alt+5')).toBe(true)
  })
})

describe('功能快捷键改键（rebind）', () => {
  it('格式无效被拒绝', () => {
    const { hm } = setup()
    expect(hm.rebind('translate_replace', 'abc').ok).toBe(false)
  })

  it('与其他功能键相同被拒绝', () => {
    const { hm } = setup()
    const r = hm.rebind('translate_replace', 'Ctrl+Alt+2')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('冲突')
  })

  it('与常用语键 Alt+N 冲突被拒绝', () => {
    const { hm } = setup()
    hm.registerPhraseHotkeys(noop)
    const r = hm.rebind('translate_replace', 'Alt+5')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('占用')
  })

  it('改键成功后持久化', () => {
    const { hm, db } = setup()
    const r = hm.rebind('translate_replace', 'Ctrl+Shift+Q')
    expect(r.ok).toBe(true)
    const row = db
      .prepare("SELECT accelerators FROM hotkeys WHERE action_code='translate_replace'")
      .get() as { accelerators: string }
    expect(row.accelerators).toBe('Ctrl+Shift+Q')
  })
})
