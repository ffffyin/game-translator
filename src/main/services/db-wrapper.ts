// 基于内置 node:sqlite 的轻量封装，提供与原 better-sqlite3 相近的接口
// （prepare/run/get/all、exec、pragma、transaction），消除原生编译依赖
import { createRequire } from 'node:module'

// 动态加载内置模块，避免打包/测试工具尝试转换 node:sqlite
const nodeRequire = createRequire(import.meta.url)
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite')

export interface RunResult {
  changes: number | bigint
  lastInsertRowid: number | bigint
}

export interface Statement {
  run(...params: unknown[]): RunResult
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
}

export class Db {
  readonly inner: InstanceType<typeof DatabaseSync>

  constructor(path: string) {
    this.inner = new DatabaseSync(path)
  }

  prepare(sql: string): Statement {
    return this.inner.prepare(sql) as unknown as Statement
  }

  exec(sql: string): void {
    this.inner.exec(sql)
  }

  // 无返回值的 PRAGMA 设置
  pragma(expr: string): void {
    this.inner.exec(`PRAGMA ${expr}`)
  }

  // 有返回值的 PRAGMA 查询
  pragmaGet<T>(expr: string): T {
    return this.inner.prepare(`PRAGMA ${expr}`).get() as T
  }

  // 简单事务封装（本项目无嵌套事务用法）
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
    return (...args: A): R => {
      this.inner.exec('BEGIN')
      try {
        const result = fn(...args)
        this.inner.exec('COMMIT')
        return result
      } catch (err) {
        this.inner.exec('ROLLBACK')
        throw err
      }
    }
  }

  close(): void {
    this.inner.close()
  }
}
