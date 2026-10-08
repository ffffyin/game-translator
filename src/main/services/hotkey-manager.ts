import { globalShortcut } from 'electron'
import type { Db } from './db'
import { FUNCTION_ACTIONS, type HotkeyAction } from '../../shared/hotkeys'
import { normalizeAccelerator } from '../../shared/accelerator'
import { PhraseService, type PhraseRow } from './phrases'

export interface PhraseHotkeyFailure {
  phraseId: number
  accelerator: string
  reason: string
}

export interface HotkeyRow {
  id: number
  action_code: string
  accelerators: string
  enabled: number
}

export type HotkeyHandlers = Record<string, () => void>

export class HotkeyManager {
  constructor(private db: Db) {}

  // 确保动作行存在（后续里程碑可追加动作）
  seed(actions: HotkeyAction[] = FUNCTION_ACTIONS): void {
    const now = new Date().toISOString()
    const stmt = this.db.prepare(
      `INSERT INTO hotkeys (action_code, accelerators, enabled, updated_at)
       SELECT ?, ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM hotkeys WHERE action_code = ?)`
    )
    const tx = this.db.transaction(() => {
      for (const a of actions) {
        stmt.run(a.actionCode, a.defaultAccelerator, now, a.actionCode)
      }
    })
    tx()
  }

  getAll(): HotkeyRow[] {
    return this.db.prepare('SELECT * FROM hotkeys ORDER BY id').all() as HotkeyRow[]
  }

  // 注册全部已启用快捷键；返回注册失败的动作
  registerAll(handlers: HotkeyHandlers): string[] {
    const failures: string[] = []
    for (const row of this.getAll()) {
      if (row.enabled !== 1) continue
      const handler = handlers[row.action_code]
      if (!handler) continue
      if (globalShortcut.isRegistered(row.accelerators)) continue
      const ok = globalShortcut.register(row.accelerators, handler)
      if (!ok) failures.push(row.action_code)
    }
    return failures
  }

  unregisterAll(): void {
    globalShortcut.unregisterAll()
    this.phraseKeys.clear()
  }

  private phraseKeys = new Set<string>()

  // 注册已启用常用语的快捷键（应在功能快捷键注册之后调用）
  registerPhraseHotkeys(handlerFor: (p: PhraseRow) => (() => void) | null): {
    registered: number
    failures: PhraseHotkeyFailure[]
  } {
    const phrases = new PhraseService(this.db).listEnabled()
    const failures: PhraseHotkeyFailure[] = []
    let registered = 0
    for (const p of phrases) {
      if (!p.accelerator) continue
      const handler = handlerFor(p)
      if (!handler) continue
      if (globalShortcut.isRegistered(p.accelerator)) {
        failures.push({ phraseId: p.id, accelerator: p.accelerator, reason: '与功能快捷键或其他常用语冲突' })
        continue
      }
      const ok = globalShortcut.register(p.accelerator, handler)
      if (!ok) {
        failures.push({ phraseId: p.id, accelerator: p.accelerator, reason: '被系统或其他软件占用' })
        continue
      }
      this.phraseKeys.add(p.accelerator)
      registered += 1
    }
    return { registered, failures }
  }

  // 常用语变动后重注册（只动常用语占用的键）
  refreshPhraseHotkeys(handlerFor: (p: PhraseRow) => (() => void) | null): {
    registered: number
    failures: PhraseHotkeyFailure[]
  } {
    for (const key of this.phraseKeys) {
      if (globalShortcut.isRegistered(key)) globalShortcut.unregister(key)
    }
    this.phraseKeys.clear()
    return this.registerPhraseHotkeys(handlerFor)
  }

  // 修改快捷键：校验格式 → 查重 → 试注册 → 持久化
  rebind(actionCode: string, rawAccelerator: string): { ok: boolean; error?: string } {
    const norm = normalizeAccelerator(rawAccelerator)
    if (!norm) return { ok: false, error: '快捷键格式无效' }

    const row = this.db
      .prepare('SELECT * FROM hotkeys WHERE action_code = ?')
      .get(actionCode) as HotkeyRow | undefined
    if (!row) return { ok: false, error: '动作不存在' }

    const dup = this.db
      .prepare('SELECT action_code FROM hotkeys WHERE accelerators = ? AND action_code <> ?')
      .get(norm, actionCode)
    if (dup) return { ok: false, error: `与其他动作冲突：${norm}` }

    // 先试注册新键，成功后再解绑旧键
    if (globalShortcut.isRegistered(norm)) {
      return { ok: false, error: `该组合键已被系统或其他软件占用：${norm}` }
    }
    const probe = globalShortcut.register(norm, () => {})
    if (!probe) return { ok: false, error: `系统不允许注册：${norm}` }
    globalShortcut.unregister(norm)

    if (globalShortcut.isRegistered(row.accelerators)) {
      globalShortcut.unregister(row.accelerators)
    }
    this.db
      .prepare('UPDATE hotkeys SET accelerators=?, updated_at=? WHERE action_code=?')
      .run(norm, new Date().toISOString(), actionCode)
    return { ok: true }
  }

  setEnabled(actionCode: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE hotkeys SET enabled=?, updated_at=? WHERE action_code=?')
      .run(enabled ? 1 : 0, new Date().toISOString(), actionCode)
  }
}
