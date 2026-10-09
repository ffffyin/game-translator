import type { Db } from './db-wrapper'
import { PHRASE_SLOTS } from './phrases'
import {
  emptySnapshot,
  isCloudSettingKey,
  type CloudSnapshot
} from '../../shared/cloud'

// 快照的「本机 ↔ 云端」双向转换。
// 单独成文件是为了能在单测里直接跑：CloudService 依赖 electron 与网络，测不了这两个函数。

/** 收集本机数据 → 云端快照。只取用户自己的内容，凭据类一律不进快照。 */
export function buildSnapshot(db: Db): CloudSnapshot {
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

  return snap
}

// 覆盖式写入：云端快照是「这一刻的完整配置」，不是增量补丁。
// 半合并会让本机和云端都出现「看着同步了其实缺一半」的脏状态，所以要么全量覆盖，要么不动。
export function applySnapshot(db: Db, snap: CloudSnapshot): void {
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
