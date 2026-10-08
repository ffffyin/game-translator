import { isToxicLevel, type AppSettings } from '../../shared/defaults'

export interface GlossaryTerm {
  source_text: string
  target_text: string
}

const TARGET_NAMES: Record<string, string> = {
  'zh-CN': '中文（简体）',
  en: '英语',
  ja: '日语',
  fr: '法语'
}

const STYLE_INSTRUCTIONS: Record<string, string> = {
  auto: '自动判断原文语气，用自然贴切的对应语气翻译。',
  daily: '用轻松、日常的玩家口语翻译，语气像朋友之间聊天。',
  pro: '用职业电竞选手的简洁表达，正确使用竞技术语和报点说法。',
  toxic: '按嘴臭火力档位翻译（见下方嘴臭规则）。'
}

// 嘴臭模式通用规则：先把"攻击性"拉满，再靠档位控制上限
const TOXIC_CORE = [
  '你现在的语气是【嘴臭模式】：把原文翻成目标语言玩家在公屏/队内互喷时真正会打出来的话，越扎心越好。',
  '执行规则：',
  '- 严禁礼貌化、中性化、书面化。禁止出现"请""麻烦""可以……吗""建议""希望"这类缓和说法。',
  '- 原文的嘲讽、挑衅、阴阳怪气必须被放大，而不是原样保留：平淡的指责升级成扎心嘲讽，反问句升级成羞辱式反问。',
  '- 忠实原文（重要）：只能在语气与用词上升级，禁止编造原文没有的具体事件。原文只说"你会不会玩"，不许凭空加"你蹲坑""你没买BKB""你送中路"这类原文不存在的指控。',
  '- 用目标语言游戏圈真实在用的嘴臭词与缩写：中文可用"菜狗、废物、fw、就这？、别送了、退游吧、滚去打人机吧、你这条线是提款机、你配吗、丢人"；英文可用"noob、trash、fw、boosted、dog、clown、uninstall、gg go next、free real estate、embarrassing"。',
  '- 短句最狠。能用一句怼死就别写长句；保留原文的换行与条数，不要合并。',
  '- 安全边界：只嘲讽游戏内表现与操作，不得涉及种族、国籍、性别、宗教、地域歧视，不得人身威胁或泄露隐私。'
].join('\n')

const TOXIC_LEVEL_INSTRUCTIONS: Record<string, string> = {
  mild: [
    '火力档位【阴阳怪气】：',
    '- 句句带刺、冷嘲热讽、居高临下，但不爆粗口、不骂家人、不做羞辱式比喻。',
    '- 原文没有攻击意图时，译出调侃与嫌弃的腔调即可，不要升级成辱骂。'
  ].join('\n'),
  trash: [
    '火力档位【标准嘴臭】：',
    '- 直接开喷，允许轻度脏话与人格化嘲讽（废物、菜狗、noob、trash 等），扎心但就事论事。',
    '- 即使原文只是平淡陈述或普通质疑，也要带上明显的嘲讽腔（居高临下、嫌弃、看不起）。',
    '- 例："你会不会玩" → 中文"你会不会玩啊？这操作看得我脑壳疼，菜就多练"；英文"You even know how to play? Embarrassing, go practice bot games noob."'
  ].join('\n'),
  nuclear: [
    '火力档位【火力全开】：',
    '- 骂到对方想退游。允许狠毒的侮辱词、羞辱式比喻与夸张嘲讽，允许在原文含义之上追加游戏圈通用嘲讽（"就这水平还是去打人机吧""你是我见过最贵的提款机""这波我奶奶来都比你强"）。',
    '- 仍然不得编造原文没有的具体事件、不得越界歧视或人身威胁。',
    '- 例："打得不错" → 中文"打得不错？不错个屁，你这条线是给对面送温暖的吧"；英文"Playing well? Nah, you are just free real estate for the enemy, uninstall clown."'
  ].join('\n')
}

export function buildToxicInstruction(level?: string): string {
  const lv = level && isToxicLevel(level) ? level : 'trash'
  return `${TOXIC_CORE}\n${TOXIC_LEVEL_INSTRUCTIONS[lv]}`
}

export interface PromptInput {
  text: string
  settings: AppSettings
  terms?: GlossaryTerm[]
}

export function buildSystemPrompt(settings: AppSettings, terms?: GlossaryTerm[]): string {
  const targetName = TARGET_NAMES[settings.languageTarget] ?? settings.languageTarget
  const sourceNote =
    settings.languageSource === 'auto'
      ? '源语言自动检测。'
      : `源语言为${settings.languageSource}。`
  const style = STYLE_INSTRUCTIONS[settings.translationStyle] ?? STYLE_INSTRUCTIONS.auto
  const toxicBlock =
    settings.translationStyle === 'toxic' ? buildToxicInstruction(settings.toxicLevel) : ''

  let glossary = ''
  if (terms && terms.length > 0) {
    const lines = terms
      .slice(0, 60)
      .map((t) => `- ${t.source_text}：${t.target_text}`)
      .join('\n')
    glossary = `\n术语对照（必须按此翻译）：\n${lines}\n`
  }

  return [
    '你是一名游戏内聊天翻译助手。',
    `任务：把玩家发送的消息翻译成${targetName}。${sourceNote}`,
    style,
    toxicBlock,
    '注意：',
    '- 只输出译文本身，不要加解释、前后缀、引号或标点以外的内容。',
    '- 原文可能是东南亚式英语（菲律宾、新加坡、马来西亚玩家使用，夹杂本地俚语和简写），按其真实含义翻译。',
    '- 游戏内专有词汇按游戏习惯说法翻译。',
    glossary
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildMessages(input: PromptInput): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    { role: 'system', content: buildSystemPrompt(input.settings, input.terms) },
    { role: 'user', content: input.text }
  ]
}
