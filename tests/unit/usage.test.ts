import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'path'
import { tmpdir } from 'os'
import { applyMigrations } from '../../src/main/db/schema'
import { UsageService } from '../../src/main/services/usage'
import { Db } from '../../src/main/services/db-wrapper'

describe('UsageService', () => {
  let db: Db
  let svc: UsageService

  beforeAll(() => {
    db = new Db(':memory:')
    applyMigrations(db)
    svc = new UsageService(db)
  })
  afterAll(() => db.close())

  it('记录日志', () => {
    svc.log({ kind: 'text', engine: 'deepseek-chat', chars: 10, tokensIn: 20, tokensOut: 8 })
    svc.log({ kind: 'text', engine: 'gpt-4o-mini', chars: 5, tokensIn: 9, tokensOut: 4 })
  })

  it('totals 汇总正确', () => {
    const t = svc.totals()
    expect(t.count).toBe(2)
    expect(t.chars).toBe(15)
    expect(t.tokens_in).toBe(29)
    expect(t.tokens_out).toBe(12)
  })

  it('aggregateDays 近 7 天包含今日记录', () => {
    const days = svc.aggregateDays(7)
    expect(days.length).toBe(1)
    expect(days[0].count).toBe(2)
    expect(days[0].chars).toBe(15)
  })

  it('range 查询', () => {
    const rows = svc.range('1970-01-01', '2999-01-01')
    expect(rows.length).toBe(2)
  })

  it('totalsToday 今日合计', () => {
    const t = svc.totalsToday()
    expect(t.count).toBe(2)
    expect(t.chars).toBe(15)
  })
})

describe('UsageService 按模型分组', () => {
  it('byConfig 关联模型名，已删除配置归入「已删除模型」', () => {
    const db = new Db(':memory:')
    applyMigrations(db)
    db.prepare(
      `INSERT INTO model_configs
       (id, name, provider, base_url, api_key_enc, text_model, vision_enabled, is_default, created_at, updated_at)
       VALUES (1, 'D', 'deepseek', 'u', 'x', 'm', 0, 1, 't', 't')`
    ).run()
    const svc = new UsageService(db)
    svc.log({ kind: 'text', configId: 1, chars: 3, tokensIn: 4, tokensOut: 2 })
    svc.log({ kind: 'text', configId: 1, chars: 2, tokensIn: 3, tokensOut: 1 })
    svc.log({ kind: 'vision-shot', configId: 99, chars: 1, tokensIn: 5, tokensOut: 5 })

    const rows = svc.byConfig()
    expect(rows).toHaveLength(2)
    const d = rows.find((r) => r.config_id === 1)!
    expect(d.name).toBe('D')
    expect(d.count).toBe(2)
    expect(d.chars).toBe(5)
    expect(d.tokens_in).toBe(7)
    expect(rows.find((r) => r.config_id === 99)!.name).toBe('已删除模型')
    db.close()
  })
})

describe('用量日志归档', () => {
  it('prune 只保留最近 N 天，返回删除条数', () => {
    const p = join(tmpdir(), `gt-usage-prune-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    const db = new Db(p)
    applyMigrations(db)
    const svc = new UsageService(db)
    svc.log({ kind: 'text', chars: 10 })
    db.prepare("INSERT INTO usage_logs (ts, kind, chars) VALUES (?, 'text', 5)").run(
      '2020-01-01T00:00:00.000Z'
    )
    db.prepare("INSERT INTO usage_logs (ts, kind, chars) VALUES (?, 'text', 5)").run(
      '2020-02-01T00:00:00.000Z'
    )
    expect(svc.totals().count).toBe(3)
    expect(svc.prune(90)).toBe(2)
    expect(svc.totals().count).toBe(1)
  })

  it('schema 迁移后存在用量索引', () => {
    const p = join(tmpdir(), `gt-usage-idx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
    const db = new Db(p)
    applyMigrations(db)
    const idx = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string }>
    expect(idx.map((i) => i.name)).toContain('idx_usage_logs_ts')
    expect(idx.map((i) => i.name)).toContain('idx_terms_lib')
  })
})
