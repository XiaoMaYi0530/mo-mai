import { completeGameSkillDetails, type GameAsset, type GameSkillDetails, type GameSkillOutcome, type GameSkillTarget } from './game-progression.ts'
import {
  GAME_TIER_LABELS,
  gameProgressionTierForLevel,
  generatedRarityForTier,
  type GameProgressionTier,
  type GameTierRules
} from './game-progression-tiers.ts'

export const ORIGINAL_SKILL_STYLES = ['东方玄幻', '西式奇幻', '仙侠', '科幻'] as const
export const ORIGINAL_SKILL_RARITIES = ['混合', '普通', '精良', '稀有', '史诗', '传说'] as const
export type OriginalSkillStyle = typeof ORIGINAL_SKILL_STYLES[number]
export type OriginalSkillRarity = typeof ORIGINAL_SKILL_RARITIES[number]
export type OriginalSkillType = GameSkillDetails['type']

export interface OriginalSkillRequest {
  levelMin: number
  levelMax: number
  levelStep: number
  skillsPerStage: number
  style: OriginalSkillStyle
  rarity: OriginalSkillRarity
  types: OriginalSkillType[]
  elements: string[]
  stats: Array<{ id: string; name: string }>
  tierRules?: GameTierRules
  seed: string
  existingNames?: string[]
}

const TYPE_LABEL: Record<OriginalSkillType, string> = {
  spell: '法术', combat: '战技', movement: '身法', healing: '治疗', control: '控制', support: '辅助'
}
const RARITY_MULTIPLIER: Record<Exclude<OriginalSkillRarity, '混合'>, number> = {
  普通: 0.85, 精良: 1, 稀有: 1.2, 史诗: 1.45, 传说: 1.8
}
const TYPE_COST: Record<OriginalSkillType, number> = {
  spell: 1, combat: 0.72, movement: 0.82, healing: 1.12, control: 1.08, support: 0.9
}
interface SkillNameLexicon {
  heads: string[]
  modifiers: string[]
  endings: Record<GameSkillOutcome, string[]>
}

const STYLE_WORDS: Record<OriginalSkillStyle, SkillNameLexicon> = {
  东方玄幻: {
    heads: ['裂空', '沉岳', '追影', '叠浪', '破军', '回澜', '惊鸿', '伏龙', '照夜', '断潮', '鸣沙', '逐日', '吞星', '临渊', '横江', '镇霄'],
    modifiers: ['九曜', '苍穹', '玄甲', '流光', '烛照', '天门', '孤峰', '万象', '龙骧', '夜行', '山海', '赤霄'],
    endings: { damage: ['斩', '裂', '贯', '崩', '轰', '刺', '天裂', '灭星'], healing: ['暖流', '生息', '回春', '涌泉', '续脉', '复元', '造化生机', '不灭真息'], shield: ['玄壁', '护心', '铠幕', '镇甲', '铁衣', '磐障', '镇天幕', '不灭壁'], movement: ['步', '闪', '逐影', '踏云', '掠空', '游身', '踏虚', '缩地'], control: ['锁', '镇', '囚', '定身', '缚影', '沉降', '镇界', '封天'], buff: ['战意', '凝元', '明心', '昂扬', '聚势', '锐意', '神临', '极意'], debuff: ['蚀印', '碎甲', '断势', '裂隙', '消融', '迟滞', '绝脉', '灭法'], summon: ['灵卫', '战影', '兽魂', '玄兵', '护灵', '幻身', '天兵', '神兽'] }
  },
  西式奇幻: {
    heads: ['鹰翼', '银誓', '黑棘', '晨星', '灰塔', '断罪', '暮鸦', '秘银', '荆冠', '狮心', '霜堡', '古树', '月桂', '龙息', '圣杯', '夜钟'],
    modifiers: ['王庭', '古老', '无眠', '猩红', '苍白', '翡翠', '黄金', '幽影', '圣堂', '荒原', '群星', '深渊'],
    endings: { damage: ['之刃', '冲击', '穿刺', '重击', '箭雨', '爆裂', '末日裁决', '龙怒'], healing: ['恩典', '复苏', '祝福', '愈合', '生命泉', '圣疗', '神圣新生', '生命奇迹'], shield: ['壁垒', '帷幕', '护盾', '守望', '铁墙', '庇护', '神佑圣域', '不朽甲胄'], movement: ['跃迁', '疾行', '闪身', '飞跃', '影步', '冲锋', '天使之翼', '空间跃迁'], control: ['禁锢', '枷锁', '囚笼', '冻结', '缠绕', '沉默', '永恒冻结', '命运裁定'], buff: ['誓约', '战歌', '专注', '号角', '鼓舞', '祷言', '王者荣光', '神圣赐福'], debuff: ['衰弱', '蚀刻', '破防', '诅咒', '凋零', '迟缓', '灵魂剥夺', '终末诅咒'], summon: ['侍从', '幻兽', '守卫', '魔像', '猎犬', '使魔', '远古英灵', '世界树卫'] }
  },
  仙侠: {
    heads: ['青冥', '太虚', '归元', '破妄', '天衡', '无相', '紫府', '玉枢', '离尘', '玄都', '上清', '北斗', '灵台', '九霄', '沧溟', '洞玄'],
    modifiers: ['一气', '两仪', '三垣', '四象', '五行', '六合', '七星', '八荒', '九转', '十方', '太初', '混元'],
    endings: { damage: ['剑诀', '剑气', '雷法', '杀印', '神通', '劫光', '斩神式', '破灭指'], healing: ['生机诀', '回元法', '甘露印', '续命术', '长春功', '渡厄诀', '造化生机', '不灭道体'], shield: ['玄光罩', '护身罡', '守心印', '金钟法', '不动诀', '琉璃障', '诸天护道', '万法不侵'], movement: ['遁法', '游身步', '缩地术', '御风诀', '踏罡步', '流云身', '咫尺天涯', '虚空挪移'], control: ['定身印', '缚灵诀', '镇山法', '困神阵', '锁魂咒', '封窍指', '封天禁', '镇界法'], buff: ['养元诀', '明心法', '化神术', '燃血功', '聚灵法', '通玄诀', '天人合一', '道法自然'], debuff: ['破罡印', '蚀灵诀', '乱脉法', '削元咒', '散功符', '污灵印', '绝灵劫', '坏法天咒'], summon: ['召灵术', '御兽诀', '撒豆成兵', '请神法', '唤剑诀', '役鬼术', '天兵降世', '万灵朝宗'] }
  },
  科幻: {
    heads: ['零界', '相位', '脉冲', '矩阵', '星环', '过载', '量子', '引力', '裂变', '熵流', '光锥', '奇点', '纳米', '轨道', '棱镜', '深空'],
    modifiers: ['阿尔法', '欧米伽', '黑箱', '红移', '蓝移', '静默', '蜂群', '天穹', '先驱', '终端', '临界', '超导'],
    endings: { damage: ['切割', '射线', '爆破', '冲击', '贯穿', '湮灭', '奇点炮击', '视界崩解'], healing: ['修复', '再生', '医疗场', '活化', '重构', '组织焊合', '全域重构', '生命再造'], shield: ['偏转场', '能量盾', '装甲层', '力场', '屏障', '折射幕', '绝对屏障', '事件视界'], movement: ['闪烁', '跃迁', '加速', '折跃', '推进', '短距传送', '空间折叠', '超维跃迁'], control: ['锁定', '停滞场', '干扰网', '冻结协议', '重力井', '拘束束', '时空停滞', '维度封锁'], buff: ['增幅', '超频', '同步', '强化协议', '战术链路', '性能解锁', '全域演算', '神经飞升'], debuff: ['过载', '侵蚀', '参数扰动', '装甲剥离', '信号污染', '系统迟滞', '存在抹除', '熵值归零'], summon: ['无人机', '战斗单元', '投影体', '机仆', '浮游炮', '复制体', '星舰投影', '纳米天灾'] }
  }
}

const SKILL_TIER_CORE: Record<OriginalSkillStyle, Record<GameProgressionTier, Pick<SkillNameLexicon, 'heads' | 'modifiers'>>> = {
  东方玄幻: {
    starter: { heads: ['基础', '练武', '铁臂', '疾步', '凝气', '守式'], modifiers: ['朴素', '轻巧', '扎实', '实用'] },
    growth: { heads: ['熊力', '疾风', '赤铜', '青钢', '猎兽', '流火'], modifiers: ['淬炼', '精制', '迅捷', '坚韧'] },
    elite: { heads: ['裂空', '沉岳', '追影', '叠浪', '破军', '回澜'], modifiers: ['玄甲', '流光', '孤峰', '夜行'] },
    master: { heads: ['惊鸿', '伏龙', '照夜', '断潮', '鸣沙', '横江'], modifiers: ['苍穹', '天门', '龙骧', '赤霄'] },
    legendary: { heads: ['逐日', '吞星', '临渊', '镇霄', '开天', '镇海'], modifiers: ['九曜', '烛照', '万象', '山海'] }
  },
  西式奇幻: {
    starter: { heads: ['学徒', '守卫', '佣兵', '猎手', '旧塔', '灰羽'], modifiers: ['朴素', '轻型', '标准', '实用'] },
    growth: { heads: ['赤铜', '精钢', '疾风', '火炬', '潮汐', '狼牙'], modifiers: ['精制', '远行', '行会', '老练'] },
    elite: { heads: ['鹰翼', '银誓', '黑棘', '晨星', '暮鸦', '月桂'], modifiers: ['猩红', '苍白', '翡翠', '荒原'] },
    master: { heads: ['秘银', '灰塔', '荆冠', '狮心', '霜堡', '圣杯'], modifiers: ['王庭', '圣堂', '黄金', '幽影'] },
    legendary: { heads: ['龙息', '断罪', '古王', '天穹', '深渊', '永夜'], modifiers: ['群星', '无眠', '神谕', '不朽'] }
  },
  仙侠: {
    starter: { heads: ['引气', '凝息', '清心', '御物', '轻身', '护体'], modifiers: ['入门', '简式', '外门', '初修'] },
    growth: { heads: ['养元', '御风', '离火', '玄水', '灵木', '青玉'], modifiers: ['蕴灵', '精炼', '护法', '内门'] },
    elite: { heads: ['青冥', '归元', '破妄', '紫府', '玉枢', '离尘'], modifiers: ['两仪', '四象', '五行', '七星'] },
    master: { heads: ['太虚', '天衡', '玄都', '上清', '北斗', '灵台'], modifiers: ['八荒', '九转', '十方', '混元'] },
    legendary: { heads: ['无相', '九霄', '沧溟', '洞玄', '太初', '造化'], modifiers: ['一气', '三垣', '鸿蒙', '无极'] }
  },
  科幻: {
    starter: { heads: ['标准', '制式', '训练', '便携', '轻型', '基础'], modifiers: ['民用', '守备', '实用', '模块化'] },
    growth: { heads: ['强化', '钛钢', '战术', '热能', '电磁', '猎隼'], modifiers: ['增强', '军用', '校准', '改进'] },
    elite: { heads: ['零界', '脉冲', '矩阵', '星环', '极光', '棱镜'], modifiers: ['蜂群', '静默', '天穹', '先驱'] },
    master: { heads: ['相位', '量子', '引力', '裂变', '纳米', '轨道'], modifiers: ['红移', '蓝移', '临界', '超导'] },
    legendary: { heads: ['熵流', '光锥', '奇点', '深空', '视界', '终端'], modifiers: ['阿尔法', '欧米伽', '黑箱', '天启'] }
  }
}

const TIER_ENDING_INDEXES: Record<GameProgressionTier, number[]> = {
  starter: [0, 1], growth: [1, 2, 3], elite: [2, 3, 4], master: [4, 5], legendary: [6, 7]
}

const ELEMENT_NAME_WORDS: Record<string, string[]> = {
  火: ['炎', '焰', '烬', '熔', '赤'], 水: ['潮', '澜', '汐', '泉', '沧'], 风: ['岚', '风', '罡', '云', '迅'], 土: ['岳', '岩', '尘', '坤', '磐'],
  雷: ['雷', '霆', '电', '震', '曜'], 冰: ['冰', '霜', '寒', '凛', '雪'], 光: ['光', '曜', '辉', '圣', '昼'], 暗: ['暗', '影', '幽', '蚀', '夜'],
  无属性: ['无形', '纯元', '空明', '原初', '本源']
}
const WESTERN_ELEMENT_NAME_WORDS: Record<string, string[]> = {
  火: ['烈焰', '灰烬', '熔火', '赤焰', '灼热'], 水: ['潮汐', '深海', '碧波', '流水', '海蓝'], 风: ['疾风', '暴风', '长风', '飓风', '天风'], 土: ['大地', '岩石', '磐石', '砂砾', '地脉'],
  雷: ['雷霆', '闪电', '风暴', '霹雳', '轰雷'], 冰: ['寒霜', '凛冬', '冰川', '霜雪', '极寒'], 光: ['圣光', '晨曦', '辉光', '白昼', '日耀'], 暗: ['暗影', '暮色', '幽夜', '蚀暗', '深黯'],
  无属性: ['奥术', '秘法', '源能', '无形', '纯能']
}
const SCI_FI_ELEMENT_NAME_WORDS: Record<string, string[]> = {
  火: ['热能', '等离子', '聚变', '高温', '燃烧'], 水: ['流体', '液态', '水冷', '深蓝', '潮汐'], 风: ['气旋', '湍流', '风压', '喷流', '气动'], 土: ['质量', '重力', '岩层', '硅基', '地质'],
  雷: ['电磁', '电弧', '高压', '雷暴', '离子'], 冰: ['低温', '冷冻', '寒凝', '零下', '冰晶'], 光: ['光子', '激光', '辐射', '白光', '日冕'], 暗: ['暗物质', '负光', '幽暗', '黑域', '蚀能'],
  无属性: ['动能', '纯能', '零素', '基准', '白噪']
}
const NAME_SIGILS = ['玄', '苍', '离', '照', '临', '归', '曜', '渊', '朔', '衡', '隐', '烬', '岚', '霄', '弦', '序', '界', '极', '星', '镜', '寂', '鸣', '流', '断']

const TYPE_OUTCOMES: Record<OriginalSkillType, GameSkillOutcome[]> = {
  spell: ['damage', 'damage', 'control', 'debuff'], combat: ['damage', 'damage', 'debuff'], movement: ['movement', 'buff'],
  healing: ['healing', 'shield'], control: ['control', 'debuff'], support: ['buff', 'shield', 'summon']
}

const TARGETS: Record<GameSkillOutcome, GameSkillTarget[]> = {
  damage: ['single', 'line', 'cone', 'area'], healing: ['single', 'multiple', 'area'], shield: ['self', 'single', 'multiple'],
  movement: ['self'], control: ['single', 'area', 'line'], buff: ['self', 'single', 'multiple'], debuff: ['single', 'area'], summon: ['self']
}

const TARGET_OBJECT: Record<GameSkillTarget, string> = {
  self: '自身', single: '单个目标', line: '直线上的目标', cone: '扇形范围内的目标', area: '范围内的目标', multiple: '多个目标'
}
const TARGET_POSSESSIVE: Record<GameSkillTarget, string> = {
  self: '自身的', single: '单个目标的', line: '直线上所有目标的', cone: '扇形范围内所有目标的', area: '范围内所有目标的', multiple: '多个目标的'
}
const PROSE_TEMPLATES: Record<GameSkillOutcome, string[]> = {
  damage: ['{power}沿着攻势骤然收束，在触及目标的瞬间向内爆开。', '一道由{power}凝成的辉光擦过地面，紧跟着撕开目标面前的空气。', '力量压进锋线，{power}只闪了一下，冲击已经落到对手身上。'],
  healing: ['{power}渗入伤口，紊乱的呼吸逐渐稳定下来。', '温和的{power}沿着血管游走，伤口边缘缓慢收紧。', '光纹在皮肤上一寸寸熄灭，疼痛随之退去，呼吸重新变得深长。'],
  shield: ['{power}贴着身体张开，表面一层层波纹将外来冲击卸向两侧。', '细密的光纹在身前咬合，像一面由{power}凝固成的透明壁垒。', '空气被{power}压成薄壳，攻击落上去时只激起一圈亮纹。'],
  movement: ['力量在脚下一叠，身影从原地骤然抽离，只留下一道尚未散尽的轨迹。', '脚尖刚刚沾地，人已顺着{power}流动的缝隙横移数步。', '周围景物被拉成短暂的虚影，再清晰时，原来的位置已经空了。'],
  control: ['{power}从目标四周合拢，将它下一个动作硬生生压在原地。', '目标脚下的{power}猛地收紧，才抬起的腿僵在半途。', '一圈由{power}凝成的印记倒扣下来，连带着周围的空气都变得沉重。'],
  buff: ['{power}贴着身体展开，将呼吸、脚步与力量重新拢成一个节奏。', '一股由{power}化成的热流沉入四肢，原本开始酸涩的肌肉重新绷紧。', '{power}掠过眼底，嘈杂的动作突然变得清晰、紧凑。'],
  debuff: ['{power}沿着目标的护甲缝隙蔓延，原本紧密的防护开始松动。', '一层由{power}凝成的阴影缠上目标关节，每次发力都慢了半拍。', '细碎的裂纹在防御表面不断扩展，{power}随之渗入暴露出的弱点。'],
  summon: ['{power}在身侧聚成清晰轮廓，随后张开眼睛，接管一侧战场。', '地面上的印记逐一点亮，一道由{power}构成的身影从中撑起，挡在施术者身前。', '{power}像被无形的线牵引，快速组成能够独立行动的战斗轮廓。']
}

const ELEMENT_POWER: Record<string, string> = {
  火: '火焰', 水: '水流', 风: '风息', 土: '大地之力', 雷: '雷霆', 冰: '寒气', 光: '圣光', 暗: '暗影', 无属性: '无形力量'
}

function hashText(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return hash >>> 0
}

function randomFrom(seed: string): () => number {
  let value = hashText(seed || 'original-skills') || 1
  return () => {
    value += 0x6d2b79f5
    let next = value
    next = Math.imul(next ^ (next >>> 15), next | 1)
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61)
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(values: T[], random: () => number): T { return values[Math.floor(random() * values.length)]! }

function buildSkillName(
  style: OriginalSkillStyle,
  words: SkillNameLexicon,
  tier: GameProgressionTier,
  type: OriginalSkillType,
  outcome: GameSkillOutcome,
  element: string,
  random: () => number
): string {
  const core = SKILL_TIER_CORE[style][tier]
  const head = pick(core.heads, random)
  const modifier = pick(core.modifiers, random)
  const endings = TIER_ENDING_INDEXES[tier].map((index) => words.endings[outcome][index]).filter((value): value is string => Boolean(value))
  const ending = pick(endings, random)
  const elementWords = style === '科幻' ? SCI_FI_ELEMENT_NAME_WORDS : style === '西式奇幻' ? WESTERN_ELEMENT_NAME_WORDS : ELEMENT_NAME_WORDS
  const elementWord = pick(elementWords[element] ?? [element], random)
  if ((style === '东方玄幻' || style === '仙侠') && tier === 'starter') {
    return type === 'combat' || type === 'movement' ? `${head}${ending}` : `${elementWord}${ending}`
  }
  if ((style === '东方玄幻' || style === '仙侠') && tier === 'growth') {
    if (type === 'combat' || type === 'movement') return random() < 0.7 ? `${head}${ending}` : `${modifier}${head}${ending}`
    return random() < 0.55 ? `${elementWord}${ending}` : `${head}${ending}`
  }
  const patternCount = tier === 'starter' ? 3 : tier === 'growth' ? 4 : 6
  const pattern = Math.floor(random() * patternCount)
  if (style === '西式奇幻') {
    if (pattern === 0) return `${head}${ending}`
    if (pattern === 1) return `${modifier}·${head}${ending}`
    if (pattern === 2) return `${elementWord}${ending}`
    if (pattern === 3) return `${modifier}${ending}`
    if (pattern === 4) return `${elementWord}·${head}${ending}`
    return `${elementWord}${head}${ending}`
  }
  if (style === '科幻') {
    if (pattern === 0) return `${head}${ending}`
    if (pattern === 1) return `${modifier}-${ending}`
    if (pattern === 2) return `${elementWord}${ending}`
    if (pattern === 3) return `${head}-${modifier}${ending}`
    if (pattern === 4) return `${modifier}·${head}${ending}`
    return `${elementWord}${head}${ending}`
  }
  if (pattern === 0) return `${head}${ending}`
  if (pattern === 1) return `${modifier}${ending}`
  if (pattern === 2) return `${elementWord}${ending}`
  if (pattern === 3) return `${modifier}${head}${ending}`
  if (pattern === 4) return `${elementWord}${head}${ending}`
  return `${head}${elementWord}${ending}`
}

function uniqueSkillName(factory: () => string, used: Set<string>, identity: string): string {
  let candidate = ''
  for (let attempt = 0; attempt < 64; attempt += 1) {
    candidate = factory()
    if (!used.has(candidate)) { used.add(candidate); return candidate }
  }
  const hash = hashText(identity)
  let salt = 0
  while (true) {
    const first = NAME_SIGILS[(hash + salt) % NAME_SIGILS.length]!
    const second = NAME_SIGILS[(Math.floor(hash / NAME_SIGILS.length) + salt * 7) % NAME_SIGILS.length]!
    const fallback = `${candidate}·${first}${second}`
    if (!used.has(fallback)) { used.add(fallback); return fallback }
    salt += 1
  }
}

export function calculateOriginalSkillCount(request: OriginalSkillRequest): number {
  if (!Number.isFinite(request.levelStep) || request.levelStep <= 0 || request.levelMax < request.levelMin) return 0
  return Math.ceil((request.levelMax - request.levelMin + 1) / request.levelStep) * request.skillsPerStage
}

function validateRequest(request: OriginalSkillRequest): void {
  if (!Number.isSafeInteger(request.levelMin) || !Number.isSafeInteger(request.levelMax)
    || request.levelMin < 1 || request.levelMax < request.levelMin || request.levelMax > 1000) throw new Error('等级区间必须是 1–1000 内的有效整数。')
  if (!Number.isSafeInteger(request.levelStep) || request.levelStep < 1 || request.levelStep > 100) throw new Error('技能阶段跨度必须在 1–100 级之间。')
  if (!Number.isSafeInteger(request.skillsPerStage) || request.skillsPerStage < 1 || request.skillsPerStage > 20) throw new Error('每阶段技能数必须在 1–20 之间。')
  if (!request.types.length) throw new Error('请至少选择一种技能类型。')
  if (!request.elements.length) throw new Error('请至少选择一种元素或力量属性。')
  if (!request.stats.length) throw new Error('当前作品没有可用于技能加成的属性。')
  if (!ORIGINAL_SKILL_STYLES.includes(request.style) || !ORIGINAL_SKILL_RARITIES.includes(request.rarity)) throw new Error('技能生成风格或品质无效。')
  if (calculateOriginalSkillCount(request) > 300) throw new Error('单次最多生成 300 个技能。')
}

function preferredStat(request: OriginalSkillRequest, preferredIds: string[]): { id: string; name: string } {
  for (const id of preferredIds) {
    const matched = request.stats.find((stat) => stat.id === id)
    if (matched) return matched
  }
  return request.stats[0]!
}

/** Generate catalogue-ready spells and combat techniques. Every skill consumes mana. */
export function generateOriginalSkills(request: OriginalSkillRequest): GameAsset[] {
  validateRequest(request)
  const random = randomFrom(request.seed)
  const words = STYLE_WORDS[request.style]
  const used = new Set(request.existingNames ?? [])
  const result: GameAsset[] = []
  let index = 0
  for (let level = request.levelMin; level <= request.levelMax; level += request.levelStep) {
    for (let item = 0; item < request.skillsPerStage; item += 1) {
      const type = request.types[index % request.types.length]!
      const element = request.elements[index % request.elements.length]!
      const tier = gameProgressionTierForLevel(level, request.tierRules)
      const rarity = request.rarity === '混合' ? generatedRarityForTier(tier, random()) : request.rarity
      const outcome = pick(TYPE_OUTCOMES[type], random)
      const target = pick(TARGETS[outcome], random)
      const name = uniqueSkillName(() => buildSkillName(request.style, words, tier, type, outcome, element, random), used, `${request.seed}:${index}:${level}:${outcome}`)
      const manaCost = Math.max(1, Math.round((4 + level * 0.8) * RARITY_MULTIPLIER[rarity] * TYPE_COST[type]))
      const cooldownSeconds = Math.max(0, Math.round((type === 'combat' ? 3 : type === 'movement' ? 6 : type === 'support' ? 8 : 5) * RARITY_MULTIPLIER[rarity]))
      const castTimeSeconds = ['combat', 'movement'].includes(type) ? 0 : Math.round((0.4 + random() * 1.6) * 10) / 10
      const range = target === 'self' ? '自身' : type === 'combat' ? '近身' : target === 'area' ? '中距离范围' : random() < 0.45 ? '中距离' : '远程'
      const scalingStat = type === 'combat' || type === 'movement'
        ? preferredStat(request, ['attack', 'strength', 'agility'])
        : outcome === 'shield' && random() < 0.35
          ? preferredStat(request, ['health', 'constitution', 'spellPower', 'intelligence'])
          : preferredStat(request, ['spellPower', 'intelligence', 'attack', 'strength'])
      const scalingStatId = scalingStat.id
      const powerMultiplier = Math.round((0.7 + random() * 0.75 + RARITY_MULTIPLIER[rarity] * 0.25) * 100) / 100
      const flatPower = Math.max(1, Math.round((8 + level * 2.2) * RARITY_MULTIPLIER[rarity]))
      const durationSeconds = ['control', 'buff', 'debuff', 'shield', 'summon'].includes(outcome) ? Math.max(2, Math.round(2 + random() * 7)) : 0
      const maxStacks = outcome === 'debuff' && ['史诗', '传说'].includes(rarity) ? 3 : 1
      const statLabel = scalingStat.name
      const magnitude = `${flatPower} + ${statLabel}×${powerMultiplier}`
      const targetObject = TARGET_OBJECT[target]
      const effect = outcome === 'damage' ? `对${targetObject}造成 ${magnitude} 点${element}伤害。`
        : outcome === 'healing' ? `为${targetObject}恢复 ${magnitude} 点生命。`
          : outcome === 'shield' ? `为${targetObject}生成可吸收 ${magnitude} 点伤害的护盾，持续 ${durationSeconds} 秒。`
            : outcome === 'movement' ? `瞬间移动一段距离，移动期间不受普通地形阻挡。`
              : outcome === 'control' ? `对${targetObject}施加定身，使其无法移动 ${durationSeconds} 秒；受到强力冲击时提前解除。`
                : outcome === 'buff' ? `使${TARGET_POSSESSIVE[target]}${type === 'movement' ? '速度' : type === 'combat' ? '攻击' : '法术强度'}提高 ${Math.max(3, Math.round(powerMultiplier * 6))}%，持续 ${durationSeconds} 秒。`
                  : outcome === 'debuff' ? `使${TARGET_POSSESSIVE[target]}${element === '无属性' ? '防御' : '魔法抗性'}降低 ${Math.max(3, Math.round(powerMultiplier * 5))}%，持续 ${durationSeconds} 秒${maxStacks > 1 ? `，最多叠加 ${maxStacks} 层` : ''}。`
                    : `召唤一个${element === '无属性' ? '无属性' : `${element}系`}战斗单位协助作战 ${durationSeconds} 秒，其威力受${statLabel}影响。`
      const condition = outcome === 'control' && random() < 0.45 ? '目标未处于霸体或免控状态' : ''
      const sideEffect = ['史诗', '传说'].includes(rarity) && random() < 0.32
        ? (type === 'combat' ? '释放后短暂降低自身防御' : '连续释放时魔法消耗提高') : ''
      const prose = pick(PROSE_TEMPLATES[outcome], random).replaceAll('{power}', ELEMENT_POWER[element] ?? `${element}属性的力量`)
      result.push({
        id: `generated-skill-${hashText(`${request.seed}:${index}:${name}`).toString(36)}`,
        kind: 'skill', name, aliases: [], description: effect, rarity,
        tags: ['原创生成', request.style, TYPE_LABEL[type], element, rarity, `${GAME_TIER_LABELS[tier]}位阶`], slotId: '', activation: 'learned',
        levelRequirement: level, bonuses: {}, source: 'manual',
        skill: completeGameSkillDetails({ type, element, manaCost, cooldownSeconds, castTimeSeconds, range, effect,
          target, outcome, scalingStatId, powerMultiplier, flatPower, durationSeconds, maxStacks, condition, sideEffect,
          prose })
      })
      index += 1
    }
  }
  return result
}
