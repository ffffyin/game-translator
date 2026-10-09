import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { Db } from '../../src/main/services/db-wrapper'
import { applyMigrations } from '../../src/main/db/schema'
import { buildSnapshot, applySnapshot } from '../../src/main/services/cloud-snapshot'
import { dpapiEncrypt, dpapiDecrypt } from '../../src/main/services/crypto'
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

/** 写一条默认模型配置（API Key 用 DPAPI 加密，与真实本机存储一致） */
async function seedModelConfig(db: Db, apiKey: string): Promise<string> {
  const enc = await dpapiEncrypt(apiKey)
  db.prepare(
    `INSERT INTO model_configs (name, provider, base_url, api_key_enc, text_model, vision_enabled, vision_model, is_default, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,1,?,?)`
  ).run('默认', 'openai', 'https://api.example.com/v1', enc, 'gpt-4o-mini', 1, 'gpt-4o', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  return enc
}

function setApiSync(db: Db, on: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('cloudSyncApi', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(on ? '1' : '0', '2026-01-01T00:00:00.000Z')
}

/** 迁移已经把 cloudNickname 播种成空串，所以这里一律用 upsert */
function setNickname(db: Db, name: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES ('cloudNickname', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(name, '2026-01-01T00:00:00.000Z')
}

function readStoredKey(db: Db): string | null {
  const row = db
    .prepare('SELECT api_key_enc FROM model_configs WHERE is_default=1 LIMIT 1')
    .get() as { api_key_enc: string | null } | undefined
  return row?.api_key_enc ?? null
}

describe('云端快照：本机 → 云端', () => {
  let db: Db
  beforeEach(() => {
    db = freshDb()
    seedLocal(db)
  })

  it('只带自建术语库，内置库不占云端空间', async () => {
    const s = await buildSnapshot(db)
    expect(s.termLibs.map((l) => l.name)).toEqual(['我的黑话'])
    expect(s.termLibs[0].terms).toEqual([
      { s: 'mid', t: '中路', tag: '位置' },
      { s: 'jungle', t: '打野', tag: undefined }
    ])
  })

  it('设置项只带上云白名单内的，开机自启/托盘不上云', async () => {
    const s = await buildSnapshot(db)
    expect(s.settings.languageTarget).toBe('ja')
    expect(s.settings.toxicLevel).toBe('nuclear')
    expect(s.settings.autoStart).toBeUndefined()
    expect(s.settings.minimizeToTray).toBeUndefined()
  })

  it('常用语分页、条目与当前页都被带上', async () => {
    const s = await buildSnapshot(db)
    expect(s.phrasePages.map((p) => p.name)).toEqual(['通用', 'Dota2'])
    expect(s.phrasePages[0].items).toHaveLength(3)
    expect(s.phrasePages[0].items[1]).toEqual({ slot: 2, content: '第2句', enabled: 0 })
    expect(s.activePhrasePage).toBe('通用')
  })

  it('产出的快照能通过校验（自己造的数据不能自己读不了）', async () => {
    const s = await buildSnapshot(db)
    const v = validateSnapshot(JSON.parse(JSON.stringify(s)))
    expect(v.ok).toBe(true)
    if (v.ok) expect(snapshotSummary(v.data)).toEqual(snapshotSummary(s))
  })
})

describe('云端快照：云端 → 本机', () => {
  it('覆盖式导入：自建库整体替换，内置库原样保留', async () => {
    const db = freshDb()
    seedLocal(db)

    const incoming: CloudSnapshot = {
      ...(await buildSnapshot(freshDb())),
      termLibs: [{ name: '另一台机器的库', game: 'custom_9', terms: [{ s: 'top', t: '上路' }] }],
      phrasePages: [{ name: '只有一页', note: '', items: [{ slot: 1, content: 'hello', enabled: 1 }] }],
      activePhrasePage: '只有一页',
      settings: { languageTarget: 'en' }
    }
    await applySnapshot(db, incoming)

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

  it('槽位超出 1~8 的条目不绑快捷键，但内容照常导入', async () => {
    const db = freshDb()
    await applySnapshot(db, {
      ...(await buildSnapshot(freshDb())),
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

  it('导入后再导出，内容与导入的快照一致（往返不丢数据）', async () => {
    const db = freshDb()
    const incoming: CloudSnapshot = {
      ...(await buildSnapshot(freshDb())),
      termLibs: [{ name: 'L', game: 'g', terms: [{ s: 'a', t: '甲' }] }],
      phrasePages: [{ name: 'P', note: 'n', items: [{ slot: 2, content: 'x', enabled: 1 }] }],
      activePhrasePage: 'P',
      settings: { languageTarget: 'fr' }
    }
    await applySnapshot(db, incoming)
    const out = await buildSnapshot(db)
    expect(out.termLibs).toEqual(incoming.termLibs)
    expect(out.phrasePages).toEqual(incoming.phrasePages)
    expect(out.settings).toEqual(incoming.settings)
    expect(out.activePhrasePage).toBe('P')
  })
})

describe('昵称随快照往返（仅展示，不参与鉴权）', () => {
  it('本机有昵称时写进 snap.accountName；为空则写 null', async () => {
    const db = freshDb()
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('cloudNickname', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run('老王', '2026-01-01T00:00:00.000Z')
    expect((await buildSnapshot(db)).accountName).toBe('老王')

    const empty = freshDb()
    expect((await buildSnapshot(empty)).accountName).toBeNull()
  })

  it('云端带来昵称时写回本机 cloudNickname', async () => {
    const db = freshDb()
    await applySnapshot(db, {
      ...(await buildSnapshot(freshDb())),
      accountName: '云端老王'
    })
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cloudNickname') as
      | { value: string }
      | undefined
    expect(row?.value).toBe('云端老王')
  })

  it('云端没有昵称时**不覆盖**本机已有的（拉一次云端不该清掉用户刚改的昵称）', async () => {
    const db = freshDb()
    setNickname(db, '本机老王')
    for (const accountName of [null, undefined, '', '   ']) {
      await applySnapshot(db, {
        ...(await buildSnapshot(freshDb())),
        accountName
      })
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('cloudNickname') as
        | { value: string }
        | undefined
      expect(row?.value).toBe('本机老王')
    }
  })

  it('昵称不混进 settings 白名单：即使本机存了，快照的 settings 里也不该出现', async () => {
    const db = freshDb()
    setNickname(db, '老王')
    const s = await buildSnapshot(db)
    expect(s.settings.cloudNickname).toBeUndefined()
    expect(s.accountName).toBe('老王')
  })
})

describe('API 配置可选上云', () => {
  it('开关为 0（默认）时快照里不带任何 API 配置', async () => {
    const db = freshDb()
    await seedModelConfig(db, 'sk-top-secret')
    const s = await buildSnapshot(db)
    expect(s.apiConfig).toBeNull()
  })

  it('开关为 1 时带出**明文** API Key（本机密文换机器解不开，上云必须还原）', async () => {
    const db = freshDb()
    const enc = await seedModelConfig(db, 'sk-top-secret')
    setApiSync(db, true)

    const s = await buildSnapshot(db)
    expect(s.apiConfig).not.toBeNull()
    expect(s.apiConfig?.apiKey).toBe('sk-top-secret')
    expect(s.apiConfig?.apiKey).not.toBe(enc)
    expect(s.apiConfig?.provider).toBe('openai')
    expect(s.apiConfig?.baseUrl).toBe('https://api.example.com/v1')
    expect(s.apiConfig?.model).toBe('gpt-4o-mini')
    expect(s.apiConfig?.visionModel).toBe('gpt-4o')
  })

  it('开关为 1 但没配过模型时，apiConfig 为 null 而不是空壳对象', async () => {
    const db = freshDb()
    setApiSync(db, true)
    const s = await buildSnapshot(db)
    expect(s.apiConfig).toBeNull()
  })

  it('本机开关为 0 时，云端带来的 apiConfig 被忽略，本机 Key 原封不动', async () => {
    const db = freshDb()
    const enc = await seedModelConfig(db, 'sk-local-only')
    setApiSync(db, false)

    await applySnapshot(db, {
      ...(await buildSnapshot(freshDb())),
      apiConfig: {
        provider: 'openai',
        baseUrl: 'https://evil.example.com/v1',
        model: 'gpt-4o',
        visionModel: '',
        apiKey: 'sk-from-cloud'
      }
    })

    expect(readStoredKey(db)).toBe(enc)
    expect(await dpapiDecrypt(readStoredKey(db)!)).toBe('sk-local-only')
  })

  it('本机开关为 1 时，云端 apiConfig 写回并以 DPAPI 密文落库', async () => {
    const db = freshDb()
    setApiSync(db, true)

    await applySnapshot(db, {
      ...(await buildSnapshot(freshDb())),
      apiConfig: {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        visionModel: '',
        apiKey: 'sk-from-cloud'
      }
    })

    const stored = readStoredKey(db)
    expect(stored).toBeTruthy()
    expect(stored).not.toBe('sk-from-cloud')
    expect(await dpapiDecrypt(stored!)).toBe('sk-from-cloud')

    const row = db
      .prepare('SELECT provider, base_url, text_model FROM model_configs WHERE is_default=1')
      .get() as { provider: string; base_url: string; text_model: string }
    expect(row).toEqual({
      provider: 'deepseek',
      base_url: 'https://api.deepseek.com/v1',
      text_model: 'deepseek-chat'
    })
  })

  it('带 apiConfig 的快照仍然能通过设置项白名单校验，密钥不混进 settings', async () => {
    const db = freshDb()
    await seedModelConfig(db, 'sk-top-secret')
    setApiSync(db, true)
    const s = await buildSnapshot(db)
    expect(s.apiConfig?.apiKey).toBe('sk-top-secret')
    for (const k of Object.keys(s.settings)) {
      expect(k).not.toMatch(/key|api|token|secret/i)
    }
    const v = validateSnapshot(JSON.parse(JSON.stringify(s)))
    expect(v.ok).toBe(true)
  })
})
