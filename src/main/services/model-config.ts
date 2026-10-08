import type { Db } from './db'
import type { ModelConfig, ModelConfigInput, ModelConfigView } from '../../shared/model'
import { dpapiEncrypt, dpapiDecrypt } from './crypto'

export class ModelConfigService {
  constructor(private db: Db) {}

  private toView(row: ModelConfig): ModelConfigView {
    const { api_key_enc, ...rest } = row
    return { ...rest, hasKey: !!api_key_enc }
  }

  list(): ModelConfigView[] {
    const rows = this.db
      .prepare('SELECT * FROM model_configs ORDER BY is_default DESC, id ASC')
      .all() as ModelConfig[]
    return rows.map((r) => this.toView(r))
  }

  get(id: number): ModelConfigView | undefined {
    const row = this.db
      .prepare('SELECT * FROM model_configs WHERE id = ?')
      .get(id) as ModelConfig | undefined
    return row ? this.toView(row) : undefined
  }

  private getRaw(id: number): ModelConfig | undefined {
    return this.db.prepare('SELECT * FROM model_configs WHERE id = ?').get(id) as
      | ModelConfig
      | undefined
  }

  // 供测试连接 / 翻译引擎使用的完整记录
  getForEngine(id: number): ModelConfig | undefined {
    return this.getRaw(id)
  }

  async create(input: ModelConfigInput): Promise<ModelConfigView> {
    const now = new Date().toISOString()
    const keyEnc = input.api_key ? await dpapiEncrypt(input.api_key) : null
    const count = (
      this.db.prepare('SELECT COUNT(*) AS n FROM model_configs').get() as { n: number }
    ).n

    const info = this.db
      .prepare(
        `INSERT INTO model_configs
         (name, provider, base_url, api_key_enc, text_model, vision_enabled, vision_model,
          params_json, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.name,
        input.provider,
        input.base_url,
        keyEnc,
        input.text_model,
        input.vision_enabled ?? 0,
        input.vision_model ?? null,
        input.params_json ?? null,
        count === 0 ? 1 : 0,
        now,
        now
      )
    return this.toView(this.getRaw(Number(info.lastInsertRowid))!)
  }

  async update(id: number, input: ModelConfigInput): Promise<ModelConfigView> {
    const existing = this.getRaw(id)
    if (!existing) throw new Error('模型配置不存在')
    const now = new Date().toISOString()
    let keyEnc = existing.api_key_enc
    if (input.api_key) keyEnc = await dpapiEncrypt(input.api_key)

    this.db
      .prepare(
        `UPDATE model_configs SET
           name=?, provider=?, base_url=?, api_key_enc=?, text_model=?,
           vision_enabled=?, vision_model=?, params_json=?, updated_at=?
         WHERE id=?`
      )
      .run(
        input.name,
        input.provider,
        input.base_url,
        keyEnc,
        input.text_model,
        input.vision_enabled ?? 0,
        input.vision_model ?? null,
        input.params_json ?? null,
        now,
        id
      )
    return this.toView(this.getRaw(id)!)
  }

  remove(id: number): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM model_configs WHERE id=?').run(id)
      const remaining = this.db
        .prepare('SELECT id FROM model_configs ORDER BY id LIMIT 1')
        .get() as { id: number } | undefined
      if (remaining) {
        const hasDefault = this.db
          .prepare('SELECT id FROM model_configs WHERE is_default=1')
          .get()
        if (!hasDefault) {
          this.db.prepare('UPDATE model_configs SET is_default=1 WHERE id=?').run(remaining.id)
        }
      }
    })
    tx()
  }

  setDefault(id: number): void {
    if (!this.getRaw(id)) throw new Error('模型配置不存在')
    const tx = this.db.transaction(() => {
      this.db.prepare('UPDATE model_configs SET is_default=0').run()
      this.db.prepare('UPDATE model_configs SET is_default=1 WHERE id=?').run(id)
    })
    tx()
  }

  getDefault(): ModelConfig | undefined {
    return this.db
      .prepare('SELECT * FROM model_configs WHERE is_default=1 LIMIT 1')
      .get() as ModelConfig | undefined
  }

  // 供翻译引擎使用：返回解密后的 Key
  async getDecryptedKey(id: number): Promise<string> {
    const row = this.getRaw(id)
    if (!row || !row.api_key_enc) throw new Error('该模型未配置 API Key')
    return dpapiDecrypt(row.api_key_enc)
  }
}
