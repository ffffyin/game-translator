import { describe, it, expect } from 'vitest'
import {
  CLOUD_SNAPSHOT_VERSION,
  CLOUD_SETTING_KEYS,
  emptySnapshot,
  isCloudSettingKey,
  offlineStatus,
  snapshotSummary,
  validateSnapshot,
  type CloudSnapshot
} from '../../src/shared/cloud'
import { DEFAULT_SETTINGS } from '../../src/shared/defaults'

function snap(over: Partial<CloudSnapshot> = {}): CloudSnapshot {
  return { ...emptySnapshot(), ...over }
}

describe('云端设置项白名单', () => {
  it('每个白名单键都必须是真实存在的设置项，拼错会静默丢数据', () => {
    for (const k of CLOUD_SETTING_KEYS) {
      expect(Object.keys(DEFAULT_SETTINGS)).toContain(k)
    }
  })

  it('凭据与本机强相关项一律不上云', () => {
    expect(isCloudSettingKey('autoStart')).toBe(false)
    expect(isCloudSettingKey('minimizeToTray')).toBe(false)
    expect(isCloudSettingKey('api_key_enc')).toBe(false)
    expect(isCloudSettingKey('languageTarget')).toBe(true)
  })
})

describe('云端快照校验', () => {
  it('版本不一致直接拒绝，而不是猜着导入', () => {
    const r = validateSnapshot({ ...emptySnapshot(), version: 999 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('请升级软件')
  })

  it('非对象 / 缺字段一律拒绝', () => {
    expect(validateSnapshot(null).ok).toBe(false)
    expect(validateSnapshot('x').ok).toBe(false)
    expect(validateSnapshot({ version: CLOUD_SNAPSHOT_VERSION }).ok).toBe(false)
    expect(
      validateSnapshot({ version: CLOUD_SNAPSHOT_VERSION, settings: {}, termLibs: {} }).ok
    ).toBe(false)
  })

  it('未知设置项被静默丢弃，老客户端上传的字段不该让新版本导入失败', () => {
    const r = validateSnapshot({
      version: CLOUD_SNAPSHOT_VERSION,
      settings: { languageTarget: 'ja', someRemovedKey: '1' },
      termLibs: [],
      phrasePages: []
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.settings).toEqual({ languageTarget: 'ja' })
  })

  it('丢弃空词条与畸形条目，保留正常的', () => {
    const r = validateSnapshot({
      version: CLOUD_SNAPSHOT_VERSION,
      settings: {},
      termLibs: [
        {
          name: '我的库',
          game: 'dota2',
          terms: [
            { s: 'gg', t: '打得不错' },
            { s: '  ', t: '空源词' },
            { s: 'bad' },
            'not-an-object'
          ]
        }
      ],
      phrasePages: [{ name: '通用', items: [{ slot: 1, content: 'wp', enabled: 1 }, { content: 2 }] }]
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.termLibs[0].terms).toHaveLength(1)
    expect(r.data.phrasePages[0].items).toHaveLength(1)
    expect(r.data.phrasePages[0].items[0].slot).toBe(1)
  })

  it('术语库缺名称时整体拒绝，避免导入一堆无名库', () => {
    const r = validateSnapshot({
      version: CLOUD_SNAPSHOT_VERSION,
      settings: {},
      termLibs: [{ game: 'x', terms: [] }],
      phrasePages: []
    })
    expect(r.ok).toBe(false)
  })

  it('统计摘要按词条数与条目数汇总', () => {
    const s = snap({
      termLibs: [{ name: 'a', game: '', terms: [{ s: '1', t: '一' }, { s: '2', t: '二' }] }],
      phrasePages: [{ name: 'p', note: '', items: [{ slot: 1, content: 'x', enabled: 1 }] }]
    })
    expect(snapshotSummary(s)).toEqual({ termLibs: 1, terms: 2, phrasePages: 1, phrases: 1 })
  })
})

describe('离线状态', () => {
  it('断网时返回未登录但保留可读原因，界面据此显示提示而不是白屏', () => {
    const s = offlineStatus('网络不可用')
    expect(s.signedIn).toBe(false)
    expect(s.online).toBe(false)
    expect(s.message).toBe('网络不可用')
    expect(s.available).toBe(true)
  })
})
