import type { Db } from './db'

export interface UsageEntry {
  ts?: string
  configId?: number | null
  kind: string // text | vision
  engine?: string
  chars?: number
  tokensIn?: number
  tokensOut?: number
}

export interface UsageAggregate {
  day: string
  count: number
  chars: number
  tokens_in: number
  tokens_out: number
}

export class UsageService {
  constructor(private db: Db) {}

  log(e: UsageEntry): void {
    this.db
      .prepare(
        `INSERT INTO usage_logs (ts, config_id, kind, engine, chars, tokens_in, tokens_out)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        e.ts ?? new Date().toISOString(),
        e.configId ?? null,
        e.kind,
        e.engine ?? null,
        e.chars ?? 0,
        e.tokensIn ?? 0,
        e.tokensOut ?? 0
      )
  }

  range(startISO: string, endISO: string) {
    return this.db
      .prepare('SELECT * FROM usage_logs WHERE ts >= ? AND ts <= ? ORDER BY ts DESC')
      .all(startISO, endISO)
  }

  aggregateDays(days: number): UsageAggregate[] {
    return this.db
      .prepare(
        `SELECT date(ts, 'localtime') AS day,
                COUNT(*) AS count,
                COALESCE(SUM(chars), 0) AS chars,
                COALESCE(SUM(tokens_in), 0) AS tokens_in,
                COALESCE(SUM(tokens_out), 0) AS tokens_out
         FROM usage_logs
         WHERE date(ts, 'localtime') >= date('now', 'localtime', ?)
         GROUP BY day
         ORDER BY day ASC`
      )
      .all(`-${days - 1} days`) as UsageAggregate[]
  }

  totals(): { count: number; chars: number; tokens_in: number; tokens_out: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(chars),0) AS chars,
                COALESCE(SUM(tokens_in),0) AS tokens_in,
                COALESCE(SUM(tokens_out),0) AS tokens_out
         FROM usage_logs`
      )
      .get() as { count: number; chars: number; tokens_in: number; tokens_out: number }
    return row
  }

  // 今日（本地日期）合计
  totalsToday(): { count: number; chars: number; tokens_in: number; tokens_out: number } {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(chars),0) AS chars,
                COALESCE(SUM(tokens_in),0) AS tokens_in,
                COALESCE(SUM(tokens_out),0) AS tokens_out
         FROM usage_logs
         WHERE substr(ts, 1, 10) = date('now', 'localtime')`
      )
      .get() as { count: number; chars: number; tokens_in: number; tokens_out: number }
  }

  // 按模型配置分组（已删除的配置归入「已删除模型」）
  byConfig(): Array<{
    config_id: number | null
    name: string
    count: number
    chars: number
    tokens_in: number
    tokens_out: number
  }> {
    return this.db
      .prepare(
        `SELECT u.config_id AS config_id,
                COALESCE(m.name, '已删除模型') AS name,
                COUNT(*) AS count,
                COALESCE(SUM(u.chars), 0) AS chars,
                COALESCE(SUM(u.tokens_in), 0) AS tokens_in,
                COALESCE(SUM(u.tokens_out), 0) AS tokens_out
         FROM usage_logs u
         LEFT JOIN model_configs m ON m.id = u.config_id
         GROUP BY u.config_id
         ORDER BY count DESC`
      )
      .all() as Array<{
      config_id: number | null
      name: string
      count: number
      chars: number
      tokens_in: number
      tokens_out: number
    }>
  }
}
