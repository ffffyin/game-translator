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

  // 归档：只保留最近 days 天的明细，避免 totals()/byConfig() 长期全表扫描
  // ts 与 datetime('now') 都是 UTC，用 datetime(ts) 归一化后再比较（原始字符串带 T/Z，
  // 直接和 'YYYY-MM-DD HH:MM:SS' 比会因格式不同而得出错误结果）
  prune(days = 90): number {
    const r = this.db
      .prepare(
        `DELETE FROM usage_logs
         WHERE datetime(ts) < datetime('now', ?)`
      )
      .run(`-${days} days`)
    return Number(r.changes)
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

  // 今日（本地日期）合计。
  // ts 存的是 UTC ISO，必须先换算成本地日期再比较：直接取 substr(ts,1,10) 是 UTC 日期，
  // 在北京时间 00:00-08:00 之间会把"今天凌晨"的记录算成昨天（今日合计显示 0）
  totalsToday(): { count: number; chars: number; tokens_in: number; tokens_out: number } {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(chars),0) AS chars,
                COALESCE(SUM(tokens_in),0) AS tokens_in,
                COALESCE(SUM(tokens_out),0) AS tokens_out
         FROM usage_logs
         WHERE date(ts, 'localtime') = date('now', 'localtime')`
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
