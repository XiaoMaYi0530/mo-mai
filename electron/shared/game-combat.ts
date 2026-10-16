import type { GameDerivedRules, GameProjectData, GameSnapshot } from './game-progression.ts'

export interface CombatRules {
  enabled: boolean
  baseHit: number
  minHit: number
  maxHit: number
  dodgeCap: number
  criticalCap: number
  criticalMultiplier: number
  defenseScale: number
  baseSpeed: number
  baseActionsPerSecond: number
  maxActionsPerSecond: number
}
export const DEFAULT_COMBAT_RULES: CombatRules = {
  enabled: false, baseHit: 95, minHit: 5, maxHit: 99, dodgeCap: 75, criticalCap: 75,
  criticalMultiplier: 1.5, defenseScale: 100, baseSpeed: 100, baseActionsPerSecond: 1, maxActionsPerSecond: 5
}
export interface GameRuleVersion {
  id: string
  effectiveChapterId: string
  chapterIndex: number
  derivedRules: GameDerivedRules
  flatPrecision: number
  percentPrecision: number
  combatRules: CombatRules
}
export function assertCombatRules(rules: CombatRules): void {
  if (typeof rules.enabled !== 'boolean') throw new Error('战斗规则开关无效。')
  for (const key of ['baseHit', 'minHit', 'maxHit', 'dodgeCap', 'criticalCap'] as const) {
    if (!Number.isFinite(rules[key]) || rules[key] < 0 || rules[key] > 100) throw new Error('概率必须在 0–100 之间。')
  }
  if (rules.minHit > rules.maxHit) throw new Error('最低命中率不能高于最高命中率。')
  for (const key of ['criticalMultiplier', 'defenseScale', 'baseSpeed', 'baseActionsPerSecond', 'maxActionsPerSecond'] as const) {
    if (!Number.isFinite(rules[key]) || rules[key] <= 0 || rules[key] > 1e6) throw new Error('战斗系数必须是有效正数。')
  }
}
export function assertPrecision(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 4) throw new Error('属性精度必须是 0–4 位小数。')
}
export function rulesAtChapter(data: GameProjectData, chapterIndex: number): GameProjectData {
  const version = [...(data.ruleVersions ?? [])].filter(v => v.chapterIndex <= chapterIndex)
    .sort((a, b) => b.chapterIndex - a.chapterIndex)[0]
  return version ? { ...data, derivedRules: version.derivedRules, flatPrecision: version.flatPrecision,
    percentPrecision: version.percentPrecision, combatRules: version.combatRules } : data
}
export function roundGameStat(value: number, precision: number, legacy = false): number {
  return legacy ? Math.floor(value) : Number(value.toFixed(precision))
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export interface CombatInput { damageType: 'physical' | 'magic'; power: number; flat: number; hitRoll: number; criticalRoll: number }
/** Deterministic author-reviewed resolution. Rolls are explicit 0 <= r < 100, never invented by the model. */
export function resolveCombat(attacker: GameSnapshot, defender: GameSnapshot, rules: CombatRules, input: CombatInput) {
  assertCombatRules(rules)
  if (!rules.enabled) throw new Error('请先启用并保存战斗判定规则。')
  if (attacker.characterId === defender.characterId) throw new Error('攻击者与防守者不能相同。')
  if (!['physical', 'magic'].includes(input.damageType)) throw new Error('伤害类型无效。')
  if (![input.power, input.flat].every(v => Number.isFinite(v) && v >= 0 && v <= 1e6)
    || ![input.hitRoll, input.criticalRoll].every(v => Number.isFinite(v) && v >= 0 && v < 100)) throw new Error('倍率、基础伤害或判定点数无效。')
  const stat = (snapshot: GameSnapshot, id: string) => Math.max(0, snapshot.totals[id] ?? 0)
  const dodge = Math.min(rules.dodgeCap, stat(defender, 'dodge'))
  const hitChance = clamp(rules.baseHit + stat(attacker, 'accuracy') - dodge, rules.minHit, rules.maxHit)
  const criticalChance = Math.min(rules.criticalCap, stat(attacker, 'critical'))
  const hit = input.hitRoll < hitChance
  const critical = hit && input.criticalRoll < criticalChance
  const attack = stat(attacker, input.damageType === 'physical' ? 'attack' : 'spellPower')
  const defense = stat(defender, input.damageType === 'physical' ? 'defense' : 'magicResistance')
  const damage = hit ? Math.floor((attack * input.power + input.flat) * rules.defenseScale / (rules.defenseScale + defense)
    * (critical ? rules.criticalMultiplier : 1)) : 0
  const actionsPerSecond = (s: GameSnapshot) => Number(clamp(stat(s, 'speed') / rules.baseSpeed * rules.baseActionsPerSecond, 0, rules.maxActionsPerSecond).toFixed(2))
  return { hitChance: Number(hitChance.toFixed(4)), criticalChance, hit, critical, damage,
    healthAfter: Math.max(0, defender.currentResources.health - damage), attackerActionsPerSecond: actionsPerSecond(attacker), defenderActionsPerSecond: actionsPerSecond(defender) }
}

/** Include the actual chapter's rules in AI context; disabled is an explicit boundary. */
export function formatCombatRulesForWriting(data: GameProjectData, chapterIndex: number): string {
  const effective = rulesAtChapter(data, chapterIndex)
  const rules = effective.combatRules ?? DEFAULT_COMBAT_RULES
  if (!rules.enabled) return '本章未启用战斗判定：面板值不等于实际命中、闪避概率或伤害；不得自行发明公式、伤害或判定点数。'
  return `本章战斗规则：命中率=限制(${rules.baseHit}+命中-最小(闪避,${rules.dodgeCap}),${rules.minHit},${rules.maxHit})%；暴击率=最小(暴击,${rules.criticalCap})%；伤害=向下取整((攻击或法强×技能倍率+基础伤害)×${rules.defenseScale}/(${rules.defenseScale}+防御或魔抗)×暴击时${rules.criticalMultiplier}、否则1)。每秒行动次数=最小(速度/${rules.baseSpeed}×${rules.baseActionsPerSecond},${rules.maxActionsPerSecond})。判定点数由作者明确填写，点数小于概率才成功；不得擅自生成点数或把概率写成必然结果。只使用已确认的战斗结果；魔法消耗、冷却和道具另行记录。`
}
