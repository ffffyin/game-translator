import type { Db } from './db-wrapper'
import { PHRASE_SLOTS } from './phrases'
import { dpapiDecrypt, dpapiEncrypt } from './crypto'
import { readSetting } from './settings'
import { log } from './logger'
import {
  emptySnapshot,
  isCloudSettingKey,
  type CloudApiConfig,
  type CloudSnapshot
} from '../../shared/cloud'

// 快照的「本机 ↔ 云端」双向转换。
// 单独成文件是为了能在单测里直接跑：CloudService 依赖 electron 与网络，测不了这两个函数。
//
// ⚠️ 两个函数都是 async：API Key 的加解密走 DPAPI（fork PowerShell），只能异步。
// 调用方必须 await，漏掉 await 会拿到 Promise 而不是快照。

/** 本机开关：是否允许把模型配置（含明文 API Key）放进快照 */
const API_SYNC_SETTING = 'cloudSyncApi' as const

interface ModelConfigApiRow {
  provider: string | null
  base_url: string | null
  text_model: string | null
  vision_model: string | null
  api_key_enc: string | null
}

function apiSyncEnabled(db: Db): boolean {
  try {
    return readSetting(db, API_SYNC_SETTING) === '1'
  } catch (e) {
    // 读不到就当关闭：宁可这次不同步，也不能在用户没确认过的情况下把 Key 送走
    log('WARN', '读取 API 同步开关失败，本次按「不同步」处理：' + String(e))
    return false
  }
}

/**
 * 读本机默认模型配置，API Key **解密成明文**。
 *
 * 上云必须是明文：本机存的 DPAPI 密文绑当前 Windows 用户，换台机器解不开，
 * 同步过去只是一段废数据。代价就是密钥会真的离开本机 —— 所以只有用户显式
 * 打开开关才会走到这里。
 */
async function readApiConfig(db: Db): Promise<CloudApiConfig | null> {
  let row: ModelConfigApiRow | undefined
  try {
    row = db
      .prepare(
        'SELECT provider, base_url, text_model, vision_model, api_key_enc FROM model_configs WHERE is_default=1 LIMIT 1'
      )
      .get() as ModelConfigApiRow | undefined
  } catch (e) {
    log('WARN', '读取模型配置失败，本次不上传 API 配置：' + String(e))
    return null
  }
  if (!row) return null

  let apiKey = ''
  if (row.api_key_enc) {
    try {
      apiKey = await dpapiDecrypt(row.api_key_enc)
    } catch (e) {
      // 解不开（换过系统用户 / 非 Windows）：不带半成品上云，否则会把空 Key 同步到别处
      log('WARN', '解密本机 API Key 失败，本次不上传 API 配置：' + String(e))
      return null
    }
  }
  return {
    provider: row.provider ?? '',
    baseUrl: row.base_url ?? '',
    model: row.text_model ?? '',
    visionModel: row.vision_model ?? '',
    apiKey
  }
}

/**
 * 把云端下发的模型配置写回本机，API Key **用 DPAPI 加密后**落库。
 *
 * 只改默认配置那一行；本机没有配置时才新建。整段失败只记日志不抛出 ——
 * 术语库 / 常用语才是这次同步的主体，不能因为一段可选载荷让整次导入失败。
 */
async function writeApiConfig(db: Db, cfg: CloudApiConfig): Promise<void> {
  let keyEnc: string | null = null
  if (cfg.apiKey) {
    try {
      keyEnc = await dpapiEncrypt(cfg.apiKey)
    } catch (e) {
      log('WARN', '加密云端下发的 API Key 失败，跳过 API 配置写入：' + String(e))
      return
    }
  }
  const now = new Date().toISOString()
  try {
    const existing = db
      .prepare('SELECT id FROM model_configs WHERE is_default=1 LIMIT 1')
      .get() as { id: number } | undefined
    if (existing) {
      db.prepare(
        `UPDATE model_configs SET provider=?, base_url=?, text_model=?, vision_model=?, api_key_enc=?, updated_at=? WHERE id=?`
      ).run(
        cfg.provider,
        cfg.baseUrl,
        cfg.model,
        cfg.visionModel || null,
        keyEnc,
        now,
        existing.id
      )
      return
    }
    db.prepare(
      `INSERT INTO model_configs
       (name, provider, base_url, api_key_enc, text_model, vision_enabled, vision_model,
        params_json, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      '云端同步的配置',
      cfg.provider,
      cfg.baseUrl,
      keyEnc,
      cfg.model,
      cfg.visionModel ? 1 : 0,
      cfg.visionModel || null,
      null,
      now,
      now
    )
  } catch (e) {
    log('WARN', '写入云端下发的 API 配置失败：' + String(e))
  }
}

/** 收集本机数据 → 云端快照。凭据默认不进快照，只有开关打开才带 apiConfig。 */
export async function buildSnapshot(db: Db): Promise<CloudSnapshot> {
  const snap = emptySnapshot()

  const settingRows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>
  for (const r of settingRows) {
    if (!isCloudSettingKey(r.key)) continue
    snap.settings[r.key] = r.value
  }

  // 只上传自建术语库：内置库随软件分发、可联网更新，占云端空间没有意义
  const libs = db
    .prepare('SELECT id, name, game FROM term_libraries WHERE is_builtin = 0 ORDER BY id ASC')
    .all() as Array<{ id: number; name: string; game: string }>
  for (const lib of libs) {
    const terms = db
      .prepare('SELECT source_text, target_text, tag FROM terms WHERE lib_id = ? ORDER BY id ASC')
      .all(lib.id) as Array<{ source_text: string; target_text: string; tag: string | null }>
    snap.termLibs.push({
      name: lib.name,
      game: lib.game ?? '',
      terms: terms.map((t) => ({ s: t.source_text, t: t.target_text, tag: t.tag ?? undefined }))
    })
  }

  const pages = db
    .prepare('SELECT id, name, note, is_active FROM phrase_pages ORDER BY sort_order ASC, id ASC')
    .all() as Array<{ id: number; name: string; note: string | null; is_active: number }>
  for (const p of pages) {
    const items = db
      .prepare('SELECT slot, content, enabled FROM phrases WHERE page_id = ? ORDER BY slot ASC, id ASC')
      .all(p.id) as Array<{ slot: number; content: string; enabled: number }>
    snap.phrasePages.push({
      name: p.name,
      note: p.note ?? '',
      items: items.map((i) => ({ slot: i.slot, content: i.content, enabled: i.enabled }))
    })
    if (p.is_active === 1) snap.activePhrasePage = p.name
  }

  // 开关关着就一定是 null：这是「默认不上传密钥」这条边界的唯一执行点
  snap.apiConfig = apiSyncEnabled(db) ? await readApiConfig(db) : null

  return snap
}

// 覆盖式写入：云端快照是「这一刻的完整配置」，不是增量补丁。
// 半合并会让本机和云端都出现「看着同步了其实缺一半」的脏状态，所以要么全量覆盖，要么不动。
//
// apiConfig 是唯一例外：它是**可选**载荷，且只有本机开关也开着才写回。
// 本机开关为 0 时直接忽略 —— 用户没同意把密钥上云，就同样不该被云端的密钥覆盖本机。
export async function applySnapshot(db: Db, snap: CloudSnapshot): Promise<void> {
  if (snap.apiConfig && apiSyncEnabled(db)) {
    // 放在事务外：DPAPI 是异步的，node:sqlite 的事务函数是同步的
    await writeApiConfig(db, snap.apiConfig)
  }

  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    for (const key of Object.keys(snap.settings)) {
      db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(key, snap.settings[key], now)
    }

    // 术语库：清掉所有自建库（内置库不动，它们由软件自带与联网更新维护），再按云端重建
    const customLibs = db
      .prepare('SELECT id FROM term_libraries WHERE is_builtin = 0')
      .all() as Array<{ id: number }>
    for (const l of customLibs) {
      db.prepare('DELETE FROM terms WHERE lib_id = ?').run(l.id)
      db.prepare('DELETE FROM term_libraries WHERE id = ?').run(l.id)
    }
    for (const lib of snap.termLibs) {
      const r = db
        .prepare(
          'INSERT INTO term_libraries (game, name, version, source_url, is_builtin, updated_at) VALUES (?,?,?,?,0,?)'
        )
        .run(lib.game || `custom_${Date.now()}`, lib.name, '0', null, now)
      const libId = Number(r.lastInsertRowid)
      for (const t of lib.terms) {
        db.prepare(
          'INSERT INTO terms (lib_id, source_text, target_text, tag, is_custom, updated_at) VALUES (?,?,?,?,1,?)'
        ).run(libId, t.s, t.t, t.tag ?? null, now)
      }
    }

    // 常用语：分页与条目整体重建，槽位落在 1~8 才绑 Alt+N
    db.prepare('DELETE FROM phrases').run()
    db.prepare('DELETE FROM phrase_pages').run()
    let order = 0
    for (const page of snap.phrasePages) {
      const r = db
        .prepare(
          'INSERT INTO phrase_pages (name, note, sort_order, is_active, is_builtin, updated_at) VALUES (?,?,?,?,0,?)'
        )
        .run(page.name, page.note || null, order++, page.name === snap.activePhrasePage ? 1 : 0, now)
      const pageId = Number(r.lastInsertRowid)
      let fallbackSlot = 0
      for (const item of page.items) {
        const slot = item.slot >= 1 && item.slot <= PHRASE_SLOTS ? item.slot : ++fallbackSlot
        db.prepare(
          'INSERT INTO phrases (page_id, slot, content, accelerator, sort_order, enabled, is_custom, updated_at) VALUES (?,?,?,?,?,?,1,?)'
        ).run(
          pageId,
          slot,
          item.content,
          slot >= 1 && slot <= PHRASE_SLOTS ? `Alt+${slot}` : '',
          fallbackSlot,
          item.enabled
        )
        if (slot >= 1 && slot <= PHRASE_SLOTS) fallbackSlot = slot
      }
    }
  })
  tx()
}
