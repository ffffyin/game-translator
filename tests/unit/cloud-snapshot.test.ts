import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { buildSnapshot, applySnapshot } from '../../src/main/services/cloud-snapshot'
import { snapshotSummary, validateSnapshot, type CloudSnapshot } from '../../src/shared/cloud'

let seq = 0
function freshDb(): Db {
  const p = join(tmpdir(), `gt-cloud-${Date.now()}-${seq++}.db`)
  const db = new Db(p)
  applyMigrations(db)
  return db
}

function seedLocal(db: Db): void {
  const now = '2026-01-01T00:00:00.000Z'
  // 内置库：随软件分发，不该进快照
  db.prepare(
    'INSERT INTO term_libraries (game, name, version, is_builtin, updated_at) VALUES (?,?,?,1,?)'
  ).run('general', '通用', '1', now)
  const builtinId = Number(
    (db.prepare('SELECT id FROM term_libraries WHERE game = ?').get('general') as { id: number }).id
  )
  db.prepare(
    'INSERT INTO terms (lib_id, source_text, target_text, tag, is_custom, updated_at) VALUES (?,?,?,?,0,?)'
  ).run(builtinId, 'gg', '打得不错', null, now)

  // 自建库：用户内容，必须进快照
  db.prepare(
    'INSERT INTO term_libraries (game, name, version, is_builtin, updated_at) VALUES (?,?,?,0,?)'
  ).run('custom_1', '我的黑话', '0', now)
  const libId = Number(
    (db.prepare('SELECT id FROM term_libraries WHERE game = ?').get('custom_1') as { id: number }).id
  )
  db.prepare(
    'INSERT INTO terms (lib_id, source_text, target_text, tag, is_custom, updated_at) VALUES (?,?,?,?,1,?)'
  ).run(libId, 'mid', '中路', '位置', now)
  db.prepare(
    'INSERT INTO terms (lib_id, source_text, target_text, tag, is_custom, updated_at) VALUES (?,?,?,?,1,?)'
  ).run(libId, 'jungle', '打野', null, now)

  db.prepare(
    'INSERT INTO phrase_pages (name, note, sort_order, is_active, is_builtin, updated_at) VALUES (?,?,?,?,0,?)'
  ).run('通用', '默认页', 0, 1, now)
  db.prepare(
    'INSERT INTO phrase_pages (name, note, sort_order, is_active, is_builtin, updated_at) VALUES (?,?,?,?,0,?)'
  ).run('Dota2', null, 1, 0, now)
  const p1 = Number((db.prepare('SELECT id FROM phrase_pages WHERE name = ?').get('通用') as { id: number }).id)
  for (let i = 1; i <= 3; i++) {
    db.prepare(
      'INSERT INTO phrases (page_id, slot, content, accelerator, sort_order, enabled, is_custom, updated_at) VALUES (?,?,?,?,?,?,1,?)'
    ).run(p1, i, `第${i}句`, `Alt+${i}`, i, i === 2 ? 0 : 1, now)
  }

  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)').run('languageTarget', 'ja', now)
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)').run('toxicLevel', 'nuclear', now)
  // 与本机强绑定：不该上云
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)').run('autoStart', '1', now)
  db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)').run('minimizeToTray', '1', now)
}

describe('云端快照：本机 → 云端', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    seedLocal(db)
  })

  it('只带自建术语库，内置库不占云端空间', () => {
    const s = buildSnapshot(db)
    expect(s.termLibs.map((l) => l.name)).toEqual(['我的黑话'])
    expect(s.termLibs[0].terms).toEqual([
      { s: 'mid', t: '中路', tag: '位置' },
      { s: 'jungle', t: '打野', tag: undefined }
    ])
  })

  it('设置项只带上云白名单内的，开机自启/托盘不上云', () => {
    const s = buildSnapshot(db)
    expect(s.settings.languageTarget).toBe('ja')
    expect(s.settings.toxicLevel).toBe('nuclear')
    expect(s.settings.autoStart).toBeUndefined()
    expect(s.settings.minimizeToTray).toBeUndefined()
  })

  it('常用语分页、条目与当前页都被带上', () => {
    const s = buildSnapshot(db)
    expect(s.phrasePages.map((p) => p.name)).toEqual(['通用', 'Dota2'])
    expect(s.phrasePages[0].items).toHaveLength(3)
    expect(s.phrasePages[0].items[1]).toEqual({ slot: 2, content: '第2句', enabled: 0 })
    expect(s.activePhrasePage).toBe('通用')
  })

  it('产出的快照能通过校验（自己造的数据不能自己读不了）', () => {
    const s = buildSnapshot(db)
    const v = validateSnapshot(JSON.parse(JSON.stringify(s)))
    expect(v.ok).toBe(true)
    if (v.ok) expect(snapshotSummary(v.data)).toEqual(snapshotSummary(s))
  })
})

describe('云端快照：云端 → 本机', () => {
  it('覆盖式导入：自建库整体替换，内置库原样保留', () => {
    const db = freshDb()
    seedLocal(db)

    const incoming: CloudSnapshot = {
      ...buildSnapshot(freshDb()),
      termLibs: [{ name: '另一台机器的库', game: 'custom_9', terms: [{ s: 'top', t: '上路' }] }],
      phrasePages: [{ name: '只有一页', note: '', items: [{ slot: 1, content: 'hello', enabled: 1 }] }],
      activePhrasePage: '只有一页',
      settings: { languageTarget: 'en' }
    }
    applySnapshot(db, incoming)

    const libs = db
      .prepare('SELECT name, is_builtin FROM term_libraries ORDER BY id ASC')
      .all() as Array<{ name: string; is_builtin: number }>
    expect(libs).toEqual([
      { name: '通用', is_builtin: 1 },
      { name: '另一台机器的库', is_builtin: 0 }
    ])
    // 旧自建库的词条必须被清掉，不能新旧混在一起
    const terms = db
      .prepare('SELECT source_text FROM terms ORDER BY id ASC')
      .all() as Array<{ source_text: string }>
    expect(terms.map((t) => t.source_text)).toEqual(['gg', 'top'])

    const pages = db
      .prepare('SELECT name, is_active FROM phrase_pages ORDER BY sort_order ASC')
      .all() as Array<{ name: string; is_active: number }>
    expect(pages).toEqual([{ name: '只有一页', is_active: 1 }])
    const phrases = db
      .prepare('SELECT slot, content, accelerator, enabled FROM phrases')
      .all() as Array<{ slot: number; content: string; accelerator: string; enabled: number }>
    expect(phrases).toEqual([{ slot: 1, content: 'hello', accelerator: 'Alt+1', enabled: 1 }])

    const lang = db.prepare('SELECT value FROM settings WHERE key = ?').get('languageTarget') as
      | { value: string }
      | undefined
    expect(lang?.value).toBe('en')
    // 未出现在快照里的本机强绑定项保持原值
    const auto = db.prepare('SELECT value FROM settings WHERE key = ?').get('autoStart') as
      | { value: string }
      | undefined
    expect(auto?.value).toBe('1')
  })

  it('槽位超出 1~8 的条目不绑快捷键，但内容照常导入', () => {
    const db = freshDb()
    applySnapshot(db, {
      ...buildSnapshot(freshDb()),
      phrasePages: [
        {
          name: 'P',
          note: '',
          items: [
            { slot: 9, content: '越界', enabled: 1 },
            { slot: 3, content: '三号', enabled: 1 }
          ]
        }
      ],
      activePhrasePage: 'P'
    })
    const rows = db
      .prepare('SELECT slot, accelerator FROM phrases ORDER BY id ASC')
      .all() as Array<{ slot: number; accelerator: string }>
    expect(rows[0]).toEqual({ slot: 1, accelerator: 'Alt+1' })
    expect(rows[1]).toEqual({ slot: 3, accelerator: 'Alt+3' })
  })

  it('导入后再导出，内容与导入的快照一致（往返不丢数据）', () => {
    const db = freshDb()
    const incoming: CloudSnapshot = {
      ...buildSnapshot(freshDb()),
      termLibs: [{ name: 'L', game: 'g', terms: [{ s: 'a', t: '甲' }] }],
      phrasePages: [{ name: 'P', note: 'n', items: [{ slot: 2, content: 'x', enabled: 1 }] }],
      activePhrasePage: 'P',
      settings: { languageTarget: 'fr' }
    }
    applySnapshot(db, incoming)
    const out = buildSnapshot(db)
    expect(out.termLibs).toEqual(incoming.termLibs)
    expect(out.phrasePages).toEqual(incoming.phrasePages)
    expect(out.settings).toEqual(incoming.settings)
    expect(out.activePhrasePage).toBe('P')
  })
})
