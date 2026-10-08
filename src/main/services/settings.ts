import type { Db } from './db'
import { DEFAULT_SETTINGS, isKnownSetting, type AppSettings } from '../../shared/defaults'

export class SettingsService {
  constructor(private db: Db) {}

  getAll(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string
      value: string
    }>
    const stored: Record<string, string> = {}
    for (const r of rows) stored[r.key] = r.value
    const merged = { ...DEFAULT_SETTINGS, ...stored } as unknown as Record<string, unknown>

    // 数值型设置（开关等）统一还原为 number，避免 "1" !== 1
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof typeof DEFAULT_SETTINGS>) {
      if (typeof DEFAULT_SETTINGS[key] === 'number' && typeof merged[key] === 'string') {
        const n = Number(merged[key])
        if (!Number.isNaN(n)) merged[key] = n
      }
    }
    return merged as unknown as AppSettings
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.getAll()[key]
  }

  set(key: string, rawValue: unknown): AppSettings {
    if (!isKnownSetting(key)) throw new Error(`Unknown setting: ${key}`)
    const value = String(rawValue)
    const ts = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, ts)
    return this.getAll()
  }
}
