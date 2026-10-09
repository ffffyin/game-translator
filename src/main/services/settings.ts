import type { Db } from './db-wrapper'
import { DEFAULT_SETTINGS, isKnownSetting, type AppSettings } from '../../shared/defaults'

/**
 * 直接读一个设置键（不看 getAll 的全量合并）。
 *
 * 与 SettingsService.get 的区别：这里只查一行，适合主进程内部零碎地读。读不到时
 * **回落默认值** —— 老数据库的 settings 表里没有后来新增的键，不兜底就会拿到
 * undefined，而 undefined.length 这种崩溃路径恰恰发生在「用户刚升级完」那一刻。
 */
export function readSetting(db: Db, key: keyof AppSettings): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  if (!row || typeof row.value !== 'string') return String(DEFAULT_SETTINGS[key])
  return row.value
}

/** 写一个设置键（存在则覆盖）。失败照常抛出：调用方各自决定要不要降级。 */
export function writeSetting(db: Db, key: keyof AppSettings, value: string): void {
  const ts = new Date().toISOString()
  db.prepare(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, ts)
}

/**
 * 本机新增的账号相关设置键。
 *
 * 每次启动都补齐一次。用 INSERT OR IGNORE 而不是 upsert：用户可能已经在某次登录里
 * 存过昵称/邮箱，升级后不能被默认值覆盖掉。
 */
const ACCOUNT_SETTING_KEYS: Array<keyof AppSettings> = [
  'cloudNickname',
  'cloudAccountEmail',
  'cloudRememberAccount',
  // 默认 0：保存密码与自动登录都必须由用户自己打开。它们只决定本机行为，
  // 且 cloudSavedPassword 是 DPAPI 密文，绝不在 CLOUD_SETTING_KEYS 白名单里。
  'cloudSavePassword',
  'cloudAutoLogin',
  'cloudSavedPassword',
  // 默认 0：API Key 上云必须由用户自己打开，升级不该替他做这个决定
  'cloudSyncApi',
  // 画面（截图）翻译方向。老用户升级后不覆盖已有值，但必须立刻落库，
  // 否则该键在 DB 里「可能存在也可能不存在」，云同步快照会漂移。
  'screenSource',
  'screenTarget'
]

/** 把缺失的新设置键补进数据库。幂等，可重复调用。 */
export function seedAccountSettings(db: Db): void {
  const ts = new Date().toISOString()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'
  )
  const tx = db.transaction(() => {
    for (const key of ACCOUNT_SETTING_KEYS) {
      stmt.run(key, String(DEFAULT_SETTINGS[key]), ts)
    }
  })
  tx()
}

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
