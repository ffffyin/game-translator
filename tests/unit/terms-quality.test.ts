import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { validateTermFile } from '../../src/main/services/term-io'
import type { BuiltinTermFile } from '../../src/main/services/term-library'

const DIR = join(__dirname, '..', '..', 'resources', 'terms')

function load(file: string): BuiltinTermFile {
  return JSON.parse(readFileSync(join(DIR, file), 'utf8')) as BuiltinTermFile
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))

describe('内置术语库质量', () => {
  it('四个游戏词库都存在且通过格式校验', () => {
    expect(files.sort()).toEqual(['cs2.json', 'dota2.json', 'lol.json', 'pubg.json'])
    for (const f of files) {
      const v = validateTermFile(load(f))
      expect(v.ok, `${f} 校验失败：${v.ok ? '' : v.error}`).toBe(true)
    }
  })

  it('词条无空值、无重复原文（大小写不敏感）', () => {
    for (const f of files) {
      const d = load(f)
      const seen = new Set<string>()
      for (const t of d.terms) {
        expect(t.source.trim(), `${f} 存在空原文`).not.toBe('')
        expect(t.target.trim(), `${f} 存在空译文`).not.toBe('')
        const key = t.source.trim().toLowerCase()
        expect(seen.has(key), `${f} 重复原文：${t.source}`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('每个词库条目数量足够（>= 60）', () => {
    for (const f of files) expect(load(f).terms.length, f).toBeGreaterThanOrEqual(60)
  })

  it('Dota2 词库覆盖常见装备与简称', () => {
    const src = new Set(load('dota2.json').terms.map((t) => t.source.trim().toLowerCase()))
    const need = [
      'black king bar',
      'bkb',
      'blink dagger',
      'blink',
      'manta style',
      'manta',
      'shadow blade',
      'silver edge',
      'eye of skadi',
      'butterfly',
      'daedalus',
      'desolator',
      'monkey king bar',
      'mkb',
      'assault cuirass',
      'heart of tarrasque',
      'linken\'s sphere',
      'satanic',
      'abyssal blade',
      'battle fury',
      'mjollnir',
      'shiva\'s guard',
      'scythe of vyse',
      'bloodthorn',
      'nullifier',
      'refresher orb',
      'aghanim\'s scepter',
      'shard',
      'radiance',
      'hand of midas',
      'force staff',
      'glimmer cape',
      'ghost scepter',
      'eul\'s scepter of divinity',
      'pipe of insight',
      'crimson guard',
      'blade mail',
      'lotus orb',
      'hurricane pike',
      'orchid malevolence',
      'armlet of mordiggian',
      'helm of the dominator',
      'mask of madness',
      'vladmir\'s offering',
      'mekansm',
      'guardian greaves',
      'boots of travel',
      'power treads',
      'phase boots',
      'arcane boots',
      'tranquil boots',
      'soul ring',
      'urn of shadows',
      'spirit vessel',
      'vanguard',
      'diffusal blade',
      'ethereal blade',
      'aether lens',
      'octarine core',
      'aeon disk',
      'meteor hammer',
      'rod of atos',
      'veil of discord',
      'echo sabre',
      'dragon lance',
      'dagon',
      'bloodstone',
      'solar crest',
      'medallion of courage',
      'heaven\'s halberd',
      'skull basher',
      'maelstrom',
      'desolator'
    ]
    const missing = need.filter((n) => !src.has(n))
    expect(missing, `缺少装备词条：${missing.join(', ')}`).toEqual([])
  })

  it('LOL 词库覆盖常见装备与召唤师技能', () => {
    const src = new Set(load('lol.json').terms.map((t) => t.source.trim().toLowerCase()))
    const need = [
      'trinity force',
      'infinity edge',
      'bloodthirster',
      'zhonya',
      'guardian angel',
      'ga',
      'luden',
      'rabadon',
      'void staff',
      'morello',
      'liandry',
      'rylai',
      'thornmail',
      'randuin',
      'warmog',
      'sunfire',
      'sterak',
      'botrk',
      'blade of the ruined king',
      'black cleaver',
      'qss',
      'mercury',
      'tabi',
      'goredrinker',
      'goredrinker',
      'sterak\'s gage',
      'teleport',
      'tp',
      'exhaust',
      'barrier',
      'cleanse'
    ]
    const missing = need.filter((n) => !src.has(n))
    expect(missing, `LOL 缺少词条：${missing.join(', ')}`).toEqual([])
  })

  it('CS2 词库覆盖常见武器与地图', () => {
    const src = new Set(load('cs2.json').terms.map((t) => t.source.trim().toLowerCase()))
    for (const n of [
      'ak',
      'm4a4',
      'm4a1-s',
      'awp',
      'deagle',
      'usp',
      'glock',
      'aug',
      'famas',
      'mp9',
      'mac-10',
      'ump45',
      'p90',
      'ssg08',
      'scout',
      'negev',
      'mirage',
      'dust2',
      'inferno',
      'nuke',
      'overpass',
      'ancient',
      'anubis'
    ]) {
      expect(src.has(n), `CS2 缺少词条：${n}`).toBe(true)
    }
  })

  it('PUBG 词库覆盖常见枪械与地图', () => {
    const src = new Set(load('pubg.json').terms.map((t) => t.source.trim().toLowerCase()))
    for (const n of [
      'm416',
      'akm',
      'scar-l',
      'm762',
      'groza',
      'ump45',
      'vector',
      's12k',
      'dp-28',
      '98k',
      'kar98k',
      'm24',
      'awm',
      'mini14',
      'sks',
      'slr',
      'vss',
      'win94',
      'erangel',
      'miramar',
      'sanhok',
      'vikendi',
      'taego'
    ]) {
      expect(src.has(n), `PUBG 缺少词条：${n}`).toBe(true)
    }
  })

  it('Dota2 词库覆盖常见英雄简称', () => {
    const src = new Set(load('dota2.json').terms.map((t) => t.source.trim().toLowerCase()))
    for (const h of [
      'es',
      'earthshaker',
      'am',
      'pa',
      'sf',
      'jugg',
      'cm',
      'axe',
      'pudge',
      'invoker',
      'sniper',
      'tinker',
      'storm',
      'qop',
      'spectre',
      'slark',
      'ursa',
      'zeus',
      'tide',
      'enigma',
      'magnus',
      'doom',
      'lc',
      'wk',
      'dk',
      'tb',
      'ck',
      'fv',
      'od',
      'aa',
      'bb',
      'sb',
      'sk',
      'bh'
    ]) {
      expect(src.has(h), `缺少英雄简称：${h}`).toBe(true)
    }
  })
})
