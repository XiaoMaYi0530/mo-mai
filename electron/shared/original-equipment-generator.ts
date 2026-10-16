import type { GameAsset, GameSlotDefinition, GameStatDefinition } from './game-progression'
import {
  GAME_TIER_LABELS,
  gameProgressionTierForLevel,
  generatedRarityForTier,
  type GameProgressionTier,
  type GameTierRules
} from './game-progression-tiers.ts'

export const ORIGINAL_EQUIPMENT_STYLES = ['东方玄幻', '西式奇幻', '仙侠', '科幻'] as const
export const ORIGINAL_EQUIPMENT_RARITIES = ['混合', '普通', '精良', '稀有', '史诗', '传说'] as const
export const ORIGINAL_EQUIPMENT_INTENSITIES = ['conservative', 'standard', 'heroic'] as const
export const ORIGINAL_EQUIPMENT_MODES = ['stages', 'supplement'] as const

export type OriginalEquipmentStyle = typeof ORIGINAL_EQUIPMENT_STYLES[number]
export type OriginalEquipmentRarity = typeof ORIGINAL_EQUIPMENT_RARITIES[number]
export type OriginalEquipmentIntensity = typeof ORIGINAL_EQUIPMENT_INTENSITIES[number]
export type OriginalEquipmentMode = typeof ORIGINAL_EQUIPMENT_MODES[number]

export interface OriginalEquipmentRequest {
  stats: GameStatDefinition[]
  slots: GameSlotDefinition[]
  slotIds: string[]
  levelMin: number
  levelMax: number
  mode: OriginalEquipmentMode
  /** Stage mode only. Five means 1–5, 6–10… when levelMin is 1. */
  levelStep: number
  /** Stage mode only. */
  itemsPerSlot: number
  /** Supplement mode only. */
  count: number
  rarity: OriginalEquipmentRarity
  style: OriginalEquipmentStyle
  intensity: OriginalEquipmentIntensity
  tierRules?: GameTierRules
  /** Stable within one preview; callers replace it when requesting another batch. */
  seed: string
  existingNames?: string[]
}

const RARITY_MULTIPLIER: Record<Exclude<OriginalEquipmentRarity, '混合'>, number> = {
  普通: 0.78,
  精良: 1,
  稀有: 1.28,
  史诗: 1.65,
  传说: 2.15
}

const RARITY_STAT_COUNT: Record<Exclude<OriginalEquipmentRarity, '混合'>, number> = {
  普通: 1,
  精良: 2,
  稀有: 2,
  史诗: 3,
  传说: 4
}

const SLOT_WEIGHT: Record<string, number> = {
  twohand: 1.5,
  mainhand: 1.2,
  chest: 1.15,
  legs: 1.08,
  head: 1,
  shoulder: 0.92,
  offhand: 0.9,
  hands: 0.86,
  feet: 0.84,
  waist: 0.8,
  wrist: 0.72,
  back: 0.74,
  necklace: 0.68,
  ring: 0.62,
  ring1: 0.62,
  ring2: 0.62,
  accessory: 0.72,
  accessory1: 0.72,
  accessory2: 0.72
}

const INTENSITY_MULTIPLIER: Record<OriginalEquipmentIntensity, number> = {
  conservative: 0.82,
  standard: 1,
  heroic: 1.25
}

interface EquipmentTierLexicon { prefixes: string[]; suffixes: string[]; flavor: string[] }

const EQUIPMENT_TIER_WORDS: Record<OriginalEquipmentStyle, Record<GameProgressionTier, EquipmentTierLexicon>> = {
  东方玄幻: {
    starter: { prefixes: ['力量', '敏捷', '坚固', '轻便', '粗铁', '兽皮', '练武', '守备'], suffixes: ['', '·练习', '·入门'], flavor: ['用常见材料制成，结构简单可靠', '为初入战斗者准备，便于掌握基本发力', '没有复杂纹饰，但能提供稳定保护'] },
    growth: { prefixes: ['熊力', '赤铜', '青钢', '疾风', '厚土', '炎纹', '水纹', '猎兽'], suffixes: ['', '·精制', '·淬炼', '·坚韧'], flavor: ['选用更扎实的材料反复锻打', '经过数次淬炼，已经能承受持续战斗', '纹路中储存着少量稳定力量'] },
    elite: { prefixes: ['玄铁', '苍狼', '流云', '霜纹', '裂山', '青锋', '沉沙', '龙鳞'], suffixes: ['·破阵', '·守心', '·听雷', '·藏锋'], flavor: ['以异兽材料与精炼矿材锻成', '经战场淬炼后留下稳定灵性', '器身已形成清晰而稳定的力量回路'] },
    master: { prefixes: ['赤霄', '烬火', '镇岳', '逐风', '星陨', '断江', '凌云', '天工'], suffixes: ['·焚野', '·踏云', '·镇川', '·横天'], flavor: ['出自名匠之手，能主动呼应持有者气息', '核心材料罕见，足以承载高强度力量', '历经多次大战仍保持完整灵性'] },
    legendary: { prefixes: ['烛照', '幽荧', '山海', '九曜', '天门', '万象', '龙骧', '吞星'], suffixes: ['·照世', '·开天', '·镇海', '·不朽'], flavor: ['其来历已经成为传说，器中力量近乎自成一界', '以世间难寻的神材铸成，拥有不可复制的灵性', '每次现世都会在强者之间掀起争夺'] }
  },
  西式奇幻: {
    starter: { prefixes: ['力量', '敏捷', '结实', '学徒', '粗铁', '旧制', '皮革', '守卫'], suffixes: ['', '·练习型', '·行会制'], flavor: ['由普通工匠使用常见材料打造', '是学徒与守卫常用的可靠装备', '结构朴素，便于维护和替换'] },
    growth: { prefixes: ['熊力', '赤铜', '精钢', '疾风', '厚土', '烈焰', '潮汐', '猎手'], suffixes: ['', '·精制', '·远行', '·猎获'], flavor: ['由行会工匠按成熟图谱打造', '附有简易铭文，可稳定强化战斗能力', '曾是资深冒险者常用的远行装备'] },
    elite: { prefixes: ['银誓', '暮光', '狮鹫', '秘银', '寒鸦', '晨星', '黑棘', '月桂'], suffixes: ['·守望', '·远征', '·誓约', '·猎魔'], flavor: ['采用稀有矿材并刻入完整铭文', '在精锐骑士和高阶冒险者中广受认可', '曾陪伴持有者完成数次危险远征'] },
    master: { prefixes: ['圣辉', '龙脊', '灰塔', '狩魔', '霜堡', '王庭', '翡翠', '荆冠'], suffixes: ['·壁垒', '·风暴', '·王权', '·荣光'], flavor: ['由王庭大师与铭文师共同完成', '内部封存着强大魔力，能响应持有者意志', '只有少数英雄有资格获得这种装备'] },
    legendary: { prefixes: ['群星', '古王', '深渊', '日耀', '神谕', '天穹', '龙皇', '永夜'], suffixes: ['·不朽', '·终焉', '·创世', '·神迹'], flavor: ['其名字被记载在最古老的英雄史诗中', '工艺已经失传，只留下无法仿制的孤品', '传说它曾改变一场决定大陆命运的战争'] }
  },
  仙侠: {
    starter: { prefixes: ['强身', '轻灵', '凝气', '护体', '引气', '铁木', '青石', '素纹'], suffixes: ['', '·入门', '·外门'], flavor: ['以常见灵材炼成，只刻有基础禁制', '灵韵微弱平稳，适合初学者温养', '由宗门工坊批量炼制，胜在安全可靠'] },
    growth: { prefixes: ['熊力', '赤铜', '青玉', '御风', '离火', '玄水', '养元', '灵木'], suffixes: ['', '·蕴灵', '·精炼', '·护法'], flavor: ['以灵火反复祭炼，已经生出微弱灵韵', '禁制完整，足以支撑日常斗法', '器身可随真元流转提供稳定增益'] },
    elite: { prefixes: ['太虚', '青冥', '玄霜', '问心', '归元', '紫宸', '沧溟', '玉衡'], suffixes: ['·镇煞', '·御风', '·凝神', '·破妄'], flavor: ['采用难得灵材并布下多重禁制', '器身灵韵充盈，适合长期祭炼', '曾由宗门真传弟子随身温养'] },
    master: { prefixes: ['凌霄', '天衡', '长生', '洞玄', '上清', '北斗', '九霄', '灵台'], suffixes: ['·归真', '·承天', '·渡厄', '·问道'], flavor: ['炼制时引入天地灵机，已有认主之兆', '由炼器宗师耗费多年方才炼成', '内部禁制环环相扣，可承受大神通冲击'] },
    legendary: { prefixes: ['太初', '混元', '鸿蒙', '造化', '十方', '无极', '道衍', '昆仑'], suffixes: ['·证道', '·开天', '·镇世', '·不灭'], flavor: ['器中自蕴道韵，来历可追溯至上古', '炼制方法早已失传，世间再无第二件', '一旦现世便足以引动诸宗争夺'] }
  },
  科幻: {
    starter: { prefixes: ['标准', '制式', '训练', '便携', '轻型', '基础', '民用', '守备'], suffixes: ['', '-A型', '-训练型'], flavor: ['使用成熟量产零件组装，维护成本很低', '是训练人员与基层守备的标准配置', '性能普通，但在设计工况内十分稳定'] },
    growth: { prefixes: ['强化', '钛钢', '战术', '疾风', '热能', '电磁', '流体', '猎隼'], suffixes: ['', '-改', '-战术型', '-增强型'], flavor: ['更换军用材料并升级了核心模块', '内置系统可在常规战斗中稳定输出增益', '经过多环境压力测试与参数校准'] },
    elite: { prefixes: ['零界', '脉冲', '星环', '钛晶', '极光', '曜石', '矩阵', '深空'], suffixes: ['-先锋', '-壁垒', '-巡航', '-增幅'], flavor: ['采用高规格合金与专用战斗模组制造', '核心算法经过精锐部队实战校准', '能在恶劣环境中保持完整性能'] },
    master: { prefixes: ['量子', '熵核', '天穹', '奇点', '超导', '红移', '棱镜', '轨道'], suffixes: ['-超载', '-跃迁', '-统御', '-临界'], flavor: ['使用实验室级核心与受限技术制造', '性能远超制式装备，必须由专家维护', '其运算核心能够主动适应战斗环境'] },
    legendary: { prefixes: ['创世', '终焉', '黑域', '白星', '先驱', '永恒', '神经元', '视界'], suffixes: ['-原型机', '-零号', '-天启', '-无限'], flavor: ['属于不可复制的尖端原型，档案权限极高', '核心技术超越当前时代，来源至今成谜', '它的存在本身就能改变一场星际战争的走向'] }
  }
}

const EQUIPMENT_NAME_SIGILS = ['玄', '苍', '离', '照', '临', '归', '曜', '渊', '朔', '衡', '隐', '烬', '岚', '霄', '弦', '序', '界', '极', '星', '镜', '寂', '鸣', '流', '断']

const SLOT_NOUNS: Record<OriginalEquipmentStyle, Record<string, string>> = {
  东方玄幻: { head: '战冠', shoulder: '肩铠', chest: '战甲', back: '披风', wrist: '护腕', hands: '战手', waist: '战带', legs: '腿铠', feet: '战靴', necklace: '灵坠', ring: '指环', ring1: '指环', ring2: '指环', accessory: '徽记', accessory1: '徽记', accessory2: '徽记', mainhand: '战刃', offhand: '护盾', twohand: '重锋' },
  西式奇幻: { head: '盔冠', shoulder: '肩甲', chest: '胸铠', back: '斗篷', wrist: '腕甲', hands: '护手', waist: '束带', legs: '腿甲', feet: '长靴', necklace: '项链', ring: '戒指', ring1: '戒指', ring2: '戒指', accessory: '护符', accessory1: '护符', accessory2: '护符', mainhand: '长剑', offhand: '圆盾', twohand: '大剑' },
  仙侠: { head: '道冠', shoulder: '云肩', chest: '法衣', back: '羽氅', wrist: '灵腕', hands: '法手', waist: '玉带', legs: '玄裳', feet: '云履', necklace: '灵佩', ring: '法戒', ring1: '法戒', ring2: '法戒', accessory: '宝印', accessory1: '宝印', accessory2: '宝印', mainhand: '灵剑', offhand: '法盾', twohand: '重剑' },
  科幻: { head: '头盔', shoulder: '肩模组', chest: '外骨骼', back: '背挂', wrist: '腕机', hands: '战术手套', waist: '承载带', legs: '腿甲', feet: '推进靴', necklace: '颈环', ring: '指环终端', ring1: '指环终端', ring2: '指环终端', accessory: '增幅器', accessory1: '增幅器', accessory2: '增幅器', mainhand: '战刃', offhand: '偏导盾', twohand: '重炮' }
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function randomFrom(seed: string): () => number {
  let state = hashText(seed) || 0x9e3779b9
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)]!
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1))
    ;[values[index], values[target]] = [values[target]!, values[index]!]
  }
  return values
}

const SLOT_STAT_AFFINITY: Record<string, string[]> = {
  mainhand: ['attack', 'spellPower', 'strength', 'agility', 'intelligence', 'accuracy', 'critical'],
  offhand: ['defense', 'magicResistance', 'spellPower', 'strength', 'intelligence', 'accuracy'],
  twohand: ['attack', 'spellPower', 'strength', 'agility', 'intelligence', 'critical'],
  head: ['health', 'mana', 'defense', 'magicResistance', 'constitution', 'intelligence'],
  shoulder: ['health', 'defense', 'magicResistance', 'strength', 'constitution'],
  chest: ['health', 'defense', 'magicResistance', 'constitution'],
  back: ['health', 'mana', 'magicResistance', 'agility', 'speed', 'dodge'],
  wrist: ['attack', 'defense', 'strength', 'agility', 'accuracy'],
  hands: ['attack', 'spellPower', 'strength', 'agility', 'intelligence', 'accuracy', 'critical'],
  waist: ['health', 'defense', 'magicResistance', 'strength', 'constitution'],
  legs: ['health', 'defense', 'magicResistance', 'constitution', 'agility'],
  feet: ['defense', 'agility', 'speed', 'dodge'],
  necklace: ['mana', 'spellPower', 'magicResistance', 'intelligence', 'accuracy', 'critical'],
  ring: ['mana', 'attack', 'spellPower', 'strength', 'agility', 'intelligence', 'accuracy', 'critical'],
  ring1: ['mana', 'attack', 'spellPower', 'strength', 'agility', 'intelligence', 'accuracy', 'critical'],
  ring2: ['mana', 'attack', 'spellPower', 'strength', 'agility', 'intelligence', 'accuracy', 'critical'],
  accessory: ['mana', 'speed', 'accuracy', 'dodge', 'critical', 'strength', 'agility', 'intelligence', 'luck'],
  accessory1: ['mana', 'speed', 'accuracy', 'dodge', 'critical', 'strength', 'agility', 'intelligence', 'luck'],
  accessory2: ['mana', 'speed', 'accuracy', 'dodge', 'critical', 'strength', 'agility', 'intelligence', 'luck']
}

function statsForSlot(
  stats: GameStatDefinition[], slotId: string, rarity: Exclude<OriginalEquipmentRarity, '混合'>
): GameStatDefinition[] {
  const affinity = SLOT_STAT_AFFINITY[slotId] ?? []
  let candidates = affinity.map((id) => stats.find((stat) => stat.id === id)).filter((stat): stat is GameStatDefinition => Boolean(stat))
  if (!candidates.length) candidates = stats.filter((stat) => stat.category !== 'resource' || !['mainhand', 'offhand', 'twohand'].includes(slotId))
  if (!['稀有', '史诗', '传说'].includes(rarity) || !slotId.startsWith('accessory')) {
    candidates = candidates.filter((stat) => stat.id !== 'luck')
  }
  return candidates.length ? candidates : stats.filter((stat) => stat.id !== 'luck')
}

function makeBonuses(
  stats: GameStatDefinition[], slotId: string, totalBudget: number, rarity: Exclude<OriginalEquipmentRarity, '混合'>,
  random: () => number
): Record<string, number> {
  const candidates = statsForSlot(stats, slotId, rarity)
  const count = Math.min(candidates.length, RARITY_STAT_COUNT[rarity], totalBudget)
  const selected = shuffle([...candidates], random).slice(0, Math.max(1, count))
  const weights = selected.map(() => 0.35 + random())
  const weightTotal = weights.reduce((sum, value) => sum + value, 0)
  const values = weights.map((weight) => Math.max(1, Math.floor(totalBudget * weight / weightTotal)))
  let difference = totalBudget - values.reduce((sum, value) => sum + value, 0)
  for (let index = 0; difference !== 0; index = (index + 1) % values.length) {
    if (difference > 0) { values[index] += 1; difference -= 1 }
    else if (values[index] > 1) { values[index] -= 1; difference += 1 }
  }
  return Object.fromEntries(selected.map((stat, index) => [stat.id,
    stat.unit === 'percent' ? Math.max(1, Math.ceil(values[index]! / 5)) : values[index]!]))
}

function uniqueEquipmentName(factory: () => string, used: Set<string>, identity: string): string {
  let candidate = ''
  for (let attempt = 0; attempt < 64; attempt += 1) {
    candidate = factory()
    if (!used.has(candidate)) { used.add(candidate); return candidate }
  }
  const hash = hashText(identity)
  let salt = 0
  while (true) {
    const first = EQUIPMENT_NAME_SIGILS[(hash + salt) % EQUIPMENT_NAME_SIGILS.length]!
    const second = EQUIPMENT_NAME_SIGILS[(Math.floor(hash / EQUIPMENT_NAME_SIGILS.length) + salt * 7) % EQUIPMENT_NAME_SIGILS.length]!
    const fallback = `${candidate}·${first}${second}`
    if (!used.has(fallback)) { used.add(fallback); return fallback }
    salt += 1
  }
}

function validateRequest(request: OriginalEquipmentRequest): void {
  if (!request.stats.length) throw new Error('作品需要至少定义一个人物属性。')
  if (!request.slotIds.length) throw new Error('请至少选择一个装备槽位。')
  if (!Number.isSafeInteger(request.levelMin) || !Number.isSafeInteger(request.levelMax)
    || request.levelMin < 1 || request.levelMax < request.levelMin || request.levelMax > 1000) {
    throw new Error('等级区间必须是 1–1000 内的有效整数。')
  }
  if (!ORIGINAL_EQUIPMENT_STYLES.includes(request.style)) throw new Error('装备命名风格无效。')
  if (!ORIGINAL_EQUIPMENT_RARITIES.includes(request.rarity)) throw new Error('装备品质无效。')
  if (!ORIGINAL_EQUIPMENT_INTENSITIES.includes(request.intensity)) throw new Error('数值强度无效。')
  if (!ORIGINAL_EQUIPMENT_MODES.includes(request.mode)) throw new Error('装备生成模式无效。')
  if (request.mode === 'supplement'
    && (!Number.isSafeInteger(request.count) || request.count < 1 || request.count > 300)) {
    throw new Error('补充生成数量必须在 1–300 之间。')
  }
  if (request.mode === 'stages') {
    if (!Number.isSafeInteger(request.levelStep) || request.levelStep < 1 || request.levelStep > 100) {
      throw new Error('装备阶段跨度必须在 1–100 级之间。')
    }
    if (!Number.isSafeInteger(request.itemsPerSlot) || request.itemsPerSlot < 1 || request.itemsPerSlot > 5) {
      throw new Error('每阶段每槽位必须生成 1–5 件。')
    }
  }
  const slotIds = new Set(request.slots.map((slot) => slot.id))
  if (request.slotIds.some((slotId) => !slotIds.has(slotId))) throw new Error('选择了作品尚未定义的装备槽位。')
  if (calculateOriginalEquipmentCount(request) > 300) throw new Error('单次最多生成 300 件装备，请缩小等级范围、槽位或每槽数量。')
}

export function calculateOriginalEquipmentCount(request: OriginalEquipmentRequest): number {
  if (request.mode === 'supplement') return request.count
  if (!Number.isFinite(request.levelStep) || request.levelStep <= 0) return 0
  const stages = Math.max(0, Math.ceil((request.levelMax - request.levelMin + 1) / request.levelStep))
  const slotsPerStage = request.slotIds.reduce((sum, slotId) => sum + slotCopies(request, slotId), 0)
  return stages * slotsPerStage * request.itemsPerSlot
}

function slotCopies(request: OriginalEquipmentRequest, slotId: string): number {
  const physicalIds = slotId === 'ring' ? ['ring1', 'ring2'] : slotId === 'accessory' ? ['accessory1', 'accessory2'] : []
  if (!physicalIds.length) return 1
  const copies = physicalIds.filter((id) => request.slots.some((slot) => slot.id === id && slot.enabled !== false)).length
  return Math.max(1, copies)
}

function generationPlan(request: OriginalEquipmentRequest, random: () => number): Array<{ slotId: string; level: number }> {
  if (request.mode === 'supplement') {
    const levelSpan = request.levelMax - request.levelMin + 1
    return Array.from({ length: request.count }, (_, index) => ({
      slotId: request.slotIds[index % request.slotIds.length]!,
      level: request.levelMin + Math.floor(random() * levelSpan)
    }))
  }
  const plan: Array<{ slotId: string; level: number }> = []
  for (let level = request.levelMin; level <= request.levelMax; level += request.levelStep) {
    for (const slotId of request.slotIds) {
      const copies = slotCopies(request, slotId) * request.itemsPerSlot
      for (let item = 0; item < copies; item += 1) plan.push({ slotId, level })
    }
  }
  return plan
}

/** Generate a deterministic preview. No persistence and no external/reference data access. */
export function generateOriginalEquipment(request: OriginalEquipmentRequest): GameAsset[] {
  validateRequest(request)
  const random = randomFrom(request.seed)
  const usedNames = new Set(request.existingNames ?? [])
  const plan = generationPlan(request, random)
  return plan.map(({ slotId, level }, index) => {
    const tier = gameProgressionTierForLevel(level, request.tierRules)
    const rarity = request.rarity === '混合' ? generatedRarityForTier(tier, random()) : request.rarity
    const words = EQUIPMENT_TIER_WORDS[request.style][tier]
    const budget = Math.max(1, Math.round((3 + level * 0.82) * RARITY_MULTIPLIER[rarity]
      * (SLOT_WEIGHT[slotId] ?? 0.85) * INTENSITY_MULTIPLIER[request.intensity]))
    const bonuses = makeBonuses(request.stats, slotId, budget, rarity, random)
    const noun = SLOT_NOUNS[request.style][slotId]
      ?? request.slots.find((slot) => slot.id === slotId)?.name ?? '装备'
    const name = uniqueEquipmentName(() => {
      const suffix = pick(words.suffixes, random)
      return `${pick(words.prefixes, random)}${noun}${suffix}`
    }, usedNames, `${request.seed}:${index}:${level}:${slotId}`)
    const statText = Object.keys(bonuses).map((id) => request.stats.find((stat) => stat.id === id)?.name ?? id).join('、')
    return {
      id: `generated-${hashText(`${request.seed}:${index}:${name}`).toString(36)}`,
      kind: 'equipment',
      name,
      aliases: [],
      description: `${pick(words.flavor, random)}，适合${level}级角色使用，主要强化${statText}。`,
      rarity,
      tags: ['原创生成', request.style, rarity, `${GAME_TIER_LABELS[tier]}位阶`],
      slotId,
      activation: 'equipped',
      levelRequirement: level,
      bonuses,
      source: 'manual'
    }
  })
}
