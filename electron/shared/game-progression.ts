import { DEFAULT_COMBAT_RULES, rulesAtChapter, roundGameStat, type CombatRules, type GameRuleVersion } from './game-combat.ts'
import { GAME_DEFAULT_TIER_RULES, type GameTierRules } from './game-progression-tiers.ts'

/** A project's optional, author-owned game rules and catalogue. Never infer missing numbers. */
export type GameAssetKind = 'equipment' | 'title' | 'special' | 'skill'
export type GameActivation = 'equipped' | 'owned' | 'active' | 'learned'
export type GameStatCategory = 'primary' | 'resource' | 'combat' | 'special'
export type GameSkillTarget = 'self' | 'single' | 'line' | 'cone' | 'area' | 'multiple'
export type GameSkillOutcome = 'damage' | 'healing' | 'shield' | 'movement' | 'control' | 'buff' | 'debuff' | 'summon'

export interface GameStatDefinition {
  id: string
  name: string
  category?: GameStatCategory
  /** Only primary attributes can receive level-up points by default. */
  allocatable?: boolean
  unit?: 'flat' | 'percent'
}

export const GAME_DEFAULT_STATS: GameStatDefinition[] = [
  { id: 'health', name: '生命值', category: 'resource', allocatable: false, unit: 'flat' },
  { id: 'mana', name: '魔法值', category: 'resource', allocatable: false, unit: 'flat' },
  { id: 'attack', name: '攻击', category: 'combat', allocatable: false, unit: 'flat' },
  { id: 'spellPower', name: '法术强度', category: 'combat', allocatable: false, unit: 'flat' },
  { id: 'defense', name: '防御', category: 'combat', allocatable: false, unit: 'flat' },
  { id: 'magicResistance', name: '魔法抗性', category: 'combat', allocatable: false, unit: 'flat' },
  { id: 'strength', name: '力量', category: 'primary', allocatable: true, unit: 'flat' },
  { id: 'agility', name: '敏捷', category: 'primary', allocatable: true, unit: 'flat' },
  { id: 'intelligence', name: '智力', category: 'primary', allocatable: true, unit: 'flat' },
  { id: 'constitution', name: '体质', category: 'primary', allocatable: true, unit: 'flat' },
  { id: 'speed', name: '速度', category: 'combat', allocatable: false, unit: 'flat' },
  { id: 'accuracy', name: '命中', category: 'combat', allocatable: false, unit: 'percent' },
  { id: 'dodge', name: '闪避', category: 'combat', allocatable: false, unit: 'percent' },
  { id: 'critical', name: '暴击', category: 'combat', allocatable: false, unit: 'percent' },
  { id: 'luck', name: '幸运', category: 'special', allocatable: false, unit: 'flat' }
]

export interface GameDerivedRules {
  healthPerConstitution: number
  manaPerIntelligence: number
  attackPerStrength: number
  spellPowerPerIntelligence: number
  speedPerAgility: number
  dodgePerAgility: number
  criticalPerAgility: number
}

export const GAME_DEFAULT_DERIVED_RULES: GameDerivedRules = {
  healthPerConstitution: 10,
  manaPerIntelligence: 8,
  attackPerStrength: 2,
  spellPowerPerIntelligence: 2,
  speedPerAgility: 1,
  dodgePerAgility: 0.2,
  criticalPerAgility: 0.1
}

export interface GameSlotDefinition {
  id: string
  name: string
  /** A project may hide a slot from future loadouts without changing old chapters. */
  enabled?: boolean
}

/** Sixteen visible equipment cells; two-hand is a mode occupying both hand cells. */
export const GAME_EQUIPMENT_SLOTS: GameSlotDefinition[] = [
  { id: 'head', name: '头' },
  { id: 'shoulder', name: '肩' },
  { id: 'chest', name: '胸' },
  { id: 'back', name: '背' },
  { id: 'wrist', name: '手腕' },
  { id: 'hands', name: '手' },
  { id: 'waist', name: '腰' },
  { id: 'legs', name: '腿' },
  { id: 'feet', name: '脚' },
  { id: 'necklace', name: '项链' },
  { id: 'ring1', name: '戒指一' },
  { id: 'ring2', name: '戒指二' },
  { id: 'accessory1', name: '饰品一' },
  { id: 'accessory2', name: '饰品二' },
  { id: 'mainhand', name: '主手' },
  { id: 'offhand', name: '副手' }
]

export const GAME_TWO_HAND_SLOT: GameSlotDefinition = { id: 'twohand', name: '双手武器' }
export const GAME_FLEXIBLE_SLOTS: GameSlotDefinition[] = [
  { id: 'ring', name: '戒指（任一戒指位）' },
  { id: 'accessory', name: '饰品（任一饰品位）' }
]

export interface GameAsset {
  id: string
  kind: GameAssetKind
  name: string
  aliases: string[]
  description: string
  rarity: string
  tags: string[]
  /** Equipment only. */
  slotId: string
  /** A title or special item's explicit activation rule. */
  activation: GameActivation
  levelRequirement: number
  bonuses: Record<string, number>
  source: 'manual' | 'import'
  skill?: GameSkillDetails
}

export interface GameSkillDetails {
  type: 'spell' | 'combat' | 'movement' | 'healing' | 'control' | 'support'
  element: string
  manaCost: number
  cooldownSeconds: number
  castTimeSeconds: number
  range: string
  effect: string
  target: GameSkillTarget
  outcome: GameSkillOutcome
  scalingStatId: string
  powerMultiplier: number
  flatPower: number
  durationSeconds: number
  maxStacks: number
  condition: string
  sideEffect: string
  prose: string
}

/** One normalization seam for imports, generators, legacy archives and manual entry. */
export function completeGameSkillDetails(details: Partial<GameSkillDetails> = {}): GameSkillDetails {
  return {
    type: details.type ?? 'spell', element: details.element ?? '无属性', manaCost: details.manaCost ?? 1,
    cooldownSeconds: details.cooldownSeconds ?? 0, castTimeSeconds: details.castTimeSeconds ?? 0,
    range: details.range ?? '近身', effect: details.effect ?? '', target: details.target ?? 'single',
    outcome: details.outcome ?? 'damage', scalingStatId: details.scalingStatId ?? 'spellPower',
    powerMultiplier: details.powerMultiplier ?? 1, flatPower: details.flatPower ?? 0,
    durationSeconds: details.durationSeconds ?? 0, maxStacks: details.maxStacks ?? 1,
    condition: details.condition ?? '', sideEffect: details.sideEffect ?? '', prose: details.prose ?? ''
  }
}

export interface GameCharacterSeed {
  characterId: string
  level: number
  experience: number
  freePoints: number
  baseStats: Record<string, number>
  allocatedStats: Record<string, number>
  owned: Record<string, number>
  equipped: Record<string, string>
  activeTitleId: string
  activeSpecialIds: string[]
  learnedSkillIds: string[]
  /** Undefined resource means full at the current point in replay. */
  currentResources: Partial<Record<'health' | 'mana', number>>
}

export type GameOperation =
  | { kind: 'level-up'; levels: number; /** Frozen when staged so later rule edits never rewrite history. */ pointsGranted?: number }
  | { kind: 'allocate'; statId: string; points: number }
  | { kind: 'acquire'; assetId: string; quantity: number }
  | { kind: 'equip'; assetId: string; /** Chosen cell for interchangeable rings/accessories. */ slotId?: string }
  | { kind: 'unequip'; slotId: string }
  | { kind: 'activate-title'; assetId: string }
  | { kind: 'deactivate-title' }
  | { kind: 'activate-special'; assetId: string }
  | { kind: 'deactivate-special'; assetId: string }
  | { kind: 'learn-skill'; assetId: string }
  | { kind: 'forget-skill'; assetId: string }
  | { kind: 'use-skill'; assetId: string }
  | { kind: 'take-damage'; amount: number }
  | { kind: 'restore-resource'; resourceId: 'health' | 'mana'; amount: number }
  | { kind: 'rest' }
  | { kind: 'consume'; assetId: string; quantity: number }

export interface GameEvent {
  combatActionId?: string
  combatActionKey?: string
  id: string
  characterId: string
  chapterId: string
  chapterIndex: number
  order: number
  status: 'draft' | 'committed'
  /** Chapter was removed; retain this record for recovery but never replay it. */
  orphaned?: boolean
  operation: GameOperation
  source: 'manual' | 'ai'
  /** AI run transaction and stable change key; optional for pre-feature archives/manual events. */
  aiRunId?: string
  aiChangeKey?: string
  /** Optional author/AI supplied story beat explaining when and why this change occurs. */
  narrativeNote?: string
  createdAt: string
}

export interface GameProjectData {
  version: 1
  enabled: boolean
  pointsPerLevel: number
  derivedRules: GameDerivedRules
  /** Absent on legacy archives: keep integer truncation until an explicit new version. */
  flatPrecision?: number
  percentPrecision?: number
  combatRules?: CombatRules
  ruleVersions?: GameRuleVersion[]
  tierRules: GameTierRules
  stats: GameStatDefinition[]
  slots: GameSlotDefinition[]
  /** Explicitly chosen protagonist; all other characters may use compact records. */
  protagonistCharacterId?: string
  assets: GameAsset[]
  characters: GameCharacterSeed[]
  events: GameEvent[]
}

export interface GameSnapshot {
  characterId: string
  level: number
  experience: number
  freePoints: number
  baseStats: Record<string, number>
  allocatedStats: Record<string, number>
  totals: Record<string, number>
  /** Stat ID -> named, active sources and their flat bonuses. */
  breakdown: Record<string, Array<{ sourceId: string; sourceName: string; value: number }>>
  owned: Record<string, number>
  equipped: Record<string, string>
  activeTitleId: string
  activeSpecialIds: string[]
  learnedSkillIds: string[]
  currentResources: Record<'health' | 'mana', number>
}

export interface GamePreview {
  before: GameSnapshot
  after: GameSnapshot
  delta: Record<string, number>
}

export function emptyGameProject(): GameProjectData {
  return {
    version: 1,
    enabled: false,
    pointsPerLevel: 5,
    derivedRules: { ...GAME_DEFAULT_DERIVED_RULES },
    flatPrecision: 0, percentPrecision: 2, combatRules: { ...DEFAULT_COMBAT_RULES }, ruleVersions: [],
    tierRules: { ...GAME_DEFAULT_TIER_RULES },
    stats: GAME_DEFAULT_STATS.map((stat) => ({ ...stat })),
    slots: [...GAME_EQUIPMENT_SLOTS.map((slot) => ({ ...slot })), { ...GAME_TWO_HAND_SLOT },
      ...GAME_FLEXIBLE_SLOTS.map((slot) => ({ ...slot }))],
    protagonistCharacterId: '',
    assets: [],
    characters: [],
    events: []
  }
}

export function emptyGameCharacter(characterId: string, data: GameProjectData): GameCharacterSeed {
  return {
    characterId,
    level: 1,
    experience: 0,
    freePoints: 0,
    baseStats: Object.fromEntries(data.stats.map((stat) => [stat.id, stat.id === 'health' ? 100 : stat.id === 'mana' ? 50 : 0])),
    allocatedStats: {},
    owned: {},
    equipped: {},
    activeTitleId: '',
    activeSpecialIds: [],
    learnedSkillIds: [],
    currentResources: {}
  }
}

function copySeed(seed: GameCharacterSeed): GameCharacterSeed {
  return {
    ...seed,
    baseStats: { ...seed.baseStats },
    allocatedStats: { ...seed.allocatedStats },
    owned: { ...seed.owned },
    equipped: { ...seed.equipped },
    activeSpecialIds: [...seed.activeSpecialIds],
    learnedSkillIds: [...(seed.learnedSkillIds ?? [])],
    currentResources: { ...(seed.currentResources ?? {}) }
  }
}

function requireAsset(data: GameProjectData, assetId: string): GameAsset {
  const asset = data.assets.find((candidate) => candidate.id === assetId)
  if (!asset) throw new Error('物品或称号不在已确认目录中，不能凭空使用。')
  return asset
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label}必须是正整数。`)
}

function owns(seed: GameCharacterSeed, assetId: string): boolean {
  return (seed.owned[assetId] ?? 0) > 0
}

export function isGameSlotEnabled(data: GameProjectData, slotId: string): boolean {
  return data.slots.find((slot) => slot.id === slotId)?.enabled !== false
}

export function gameAssetFitsSlot(asset: GameAsset, slotId: string): boolean {
  return asset.slotId === slotId
    || (asset.slotId === 'ring' && (slotId === 'ring1' || slotId === 'ring2'))
    || (asset.slotId === 'accessory' && (slotId === 'accessory1' || slotId === 'accessory2'))
}

function clearConflictingHandSlots(seed: GameCharacterSeed, slotId: string): void {
  if (slotId === 'twohand') {
    delete seed.equipped.mainhand
    delete seed.equipped.offhand
  } else if (slotId === 'mainhand' || slotId === 'offhand') {
    delete seed.equipped.twohand
  }
}

function applyOperation(data: GameProjectData, seed: GameCharacterSeed, operation: GameOperation): void {
  switch (operation.kind) {
    case 'level-up':
      requirePositiveInteger(operation.levels, '升级级数')
      if (operation.pointsGranted !== undefined
        && (!Number.isSafeInteger(operation.pointsGranted) || operation.pointsGranted < 0)) {
        throw new Error('升级获得点数必须是非负整数。')
      }
      seed.level += operation.levels
      seed.freePoints += operation.pointsGranted ?? operation.levels * data.pointsPerLevel
      return
    case 'allocate':
      requirePositiveInteger(operation.points, '分配点数')
      if (!data.stats.some((stat) => stat.id === operation.statId && stat.allocatable !== false)) throw new Error('该属性不允许直接加点。')
      if (seed.freePoints < operation.points) throw new Error('剩余属性点不足。')
      seed.freePoints -= operation.points
      seed.allocatedStats[operation.statId] = (seed.allocatedStats[operation.statId] ?? 0) + operation.points
      return
    case 'acquire': {
      requirePositiveInteger(operation.quantity, '获得数量')
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind === 'skill') throw new Error('技能不进入背包，请使用学习技能。')
      seed.owned[operation.assetId] = (seed.owned[operation.assetId] ?? 0) + operation.quantity
      return
    }
    case 'equip': {
      const asset = requireAsset(data, operation.assetId)
      const slotId = operation.slotId || asset.slotId
      if ((asset.kind !== 'equipment' && !(asset.kind === 'special' && asset.activation === 'equipped'))
        || !slotId || !gameAssetFitsSlot(asset, slotId)
        || !data.slots.some((slot) => slot.id === slotId)
        || slotId === 'ring' || slotId === 'accessory') {
        throw new Error('这件物品没有有效装备槽。')
      }
      if (!owns(seed, asset.id)) throw new Error('角色尚未获得该装备。')
      if (seed.level < asset.levelRequirement) throw new Error('角色等级不足，无法穿戴。')
      const alreadyEquippedCopies = Object.entries(seed.equipped)
        .filter(([slot, equippedId]) => slot !== slotId && equippedId === asset.id).length
      if (alreadyEquippedCopies >= (seed.owned[asset.id] ?? 0)) throw new Error('背包中没有足够数量的这件装备。')
      clearConflictingHandSlots(seed, slotId)
      seed.equipped[slotId] = asset.id
      return
    }
    case 'unequip':
      if (!seed.equipped[operation.slotId]) throw new Error('该装备槽当前为空。')
      delete seed.equipped[operation.slotId]
      return
    case 'activate-title': {
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind !== 'title' || asset.activation !== 'active') throw new Error('该称号不是可启用称号。')
      if (!owns(seed, asset.id)) throw new Error('角色尚未获得该称号。')
      if (seed.level < asset.levelRequirement) throw new Error('角色等级不足，无法启用称号。')
      seed.activeTitleId = asset.id
      return
    }
    case 'deactivate-title':
      seed.activeTitleId = ''
      return
    case 'activate-special': {
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind !== 'special' || asset.activation !== 'active') throw new Error('该物品不是主动激活型特殊物品。')
      if (!owns(seed, asset.id)) throw new Error('角色尚未获得该特殊物品。')
      if (seed.level < asset.levelRequirement) throw new Error('角色等级不足，无法激活该物品。')
      if (!seed.activeSpecialIds.includes(asset.id)) seed.activeSpecialIds.push(asset.id)
      return
    }
    case 'deactivate-special':
      seed.activeSpecialIds = seed.activeSpecialIds.filter((id) => id !== operation.assetId)
      return
    case 'learn-skill': {
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind !== 'skill' || asset.activation !== 'learned') throw new Error('该条目不是可学习技能。')
      if (seed.level < asset.levelRequirement) throw new Error('角色等级不足，无法学习该技能。')
      seed.learnedSkillIds ??= []
      if (!seed.learnedSkillIds.includes(asset.id)) seed.learnedSkillIds.push(asset.id)
      return
    }
    case 'forget-skill': {
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind !== 'skill') throw new Error('该条目不是技能。')
      seed.learnedSkillIds = (seed.learnedSkillIds ?? []).filter((id) => id !== asset.id)
      return
    }
    case 'use-skill': {
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind !== 'skill' || !seed.learnedSkillIds.includes(asset.id)) throw new Error('人物尚未学习该技能。')
      const manaCost = asset.skill?.manaCost ?? 1
      requirePositiveInteger(manaCost, '技能魔法消耗')
      const current = toSnapshot(data, seed).currentResources.mana
      if (current < manaCost) throw new Error(`魔法值不足，释放“${asset.name}”需要 ${manaCost} 点。`)
      seed.currentResources.mana = current - manaCost
      return
    }
    case 'take-damage': {
      requirePositiveInteger(operation.amount, '伤害数值')
      const current = toSnapshot(data, seed).currentResources.health
      seed.currentResources.health = Math.max(0, current - operation.amount)
      return
    }
    case 'restore-resource': {
      requirePositiveInteger(operation.amount, '恢复数值')
      const snapshot = toSnapshot(data, seed)
      const maximum = snapshot.totals[operation.resourceId] ?? 0
      const current = snapshot.currentResources[operation.resourceId]
      seed.currentResources[operation.resourceId] = Math.min(maximum, current + operation.amount)
      return
    }
    case 'rest': {
      const snapshot = toSnapshot(data, seed)
      seed.currentResources.health = snapshot.totals.health ?? 0
      seed.currentResources.mana = snapshot.totals.mana ?? 0
      return
    }
    case 'consume': {
      requirePositiveInteger(operation.quantity, '消耗数量')
      const asset = requireAsset(data, operation.assetId)
      if (asset.kind === 'title' || asset.kind === 'skill') throw new Error('称号或技能不能作为物品消耗。')
      if ((seed.owned[asset.id] ?? 0) < operation.quantity) throw new Error('背包数量不足。')
      const equippedCopies = Object.values(seed.equipped).filter((id) => id === asset.id).length
      if (seed.owned[asset.id] - operation.quantity < equippedCopies) throw new Error('物品正在装备中，请先卸下再消耗。')
      seed.owned[asset.id] -= operation.quantity
      if (seed.owned[asset.id] === 0) {
        seed.activeSpecialIds = seed.activeSpecialIds.filter((id) => id !== asset.id)
      }
      return
    }
  }
}

function activeAssets(data: GameProjectData, seed: GameCharacterSeed): GameAsset[] {
  const passive = data.assets.filter((asset) => {
    if (!owns(seed, asset.id)) return false
    if (seed.level < asset.levelRequirement) return false
    if (asset.kind === 'equipment' || asset.activation === 'equipped') return false
    if (asset.activation === 'owned') return true
    if (asset.kind === 'title') return seed.activeTitleId === asset.id
    return seed.activeSpecialIds.includes(asset.id)
  })
  const equipped = Object.values(seed.equipped)
    .map((id) => data.assets.find((asset) => asset.id === id))
    .filter((asset): asset is GameAsset => Boolean(asset && owns(seed, asset.id) && seed.level >= asset.levelRequirement))
  return [...passive, ...equipped]
}

function toSnapshot(data: GameProjectData, seed: GameCharacterSeed): GameSnapshot {
  const totals: Record<string, number> = {}
  const breakdown: GameSnapshot['breakdown'] = {}
  const sources = activeAssets(data, seed)
  for (const stat of data.stats) {
    const base = seed.baseStats[stat.id] ?? 0
    const allocated = seed.allocatedStats[stat.id] ?? 0
    const bonuses = sources
      .map((asset) => ({ sourceId: asset.id, sourceName: asset.name, value: asset.bonuses[stat.id] ?? 0 }))
      .filter((entry) => entry.value !== 0)
    totals[stat.id] = base + allocated + bonuses.reduce((sum, entry) => sum + entry.value, 0)
    breakdown[stat.id] = bonuses
  }
  const addDerived = (targetId: string, sourceId: string, multiplier: number): void => {
    if (!(targetId in totals) || !(sourceId in totals)) return
    if (data.stats.find((stat) => stat.id === sourceId)?.category !== 'primary') return
    const stat = data.stats.find(stat => stat.id === targetId)
    const precision = stat?.unit === 'percent' ? data.percentPrecision : data.flatPrecision
    const value = roundGameStat((totals[sourceId] ?? 0) * multiplier, precision ?? 0, precision === undefined)
    if (!value) return
    totals[targetId] += value
    breakdown[targetId].push({ sourceId: `derived:${sourceId}`, sourceName: `${data.stats.find((stat) => stat.id === sourceId)?.name ?? sourceId}换算`, value })
  }
  const rules = data.derivedRules ?? GAME_DEFAULT_DERIVED_RULES
  addDerived('health', 'constitution', rules.healthPerConstitution)
  addDerived('mana', 'intelligence', rules.manaPerIntelligence)
  addDerived('attack', 'strength', rules.attackPerStrength)
  addDerived('spellPower', 'intelligence', rules.spellPowerPerIntelligence)
  addDerived('speed', 'agility', rules.speedPerAgility)
  addDerived('dodge', 'agility', rules.dodgePerAgility)
  addDerived('critical', 'agility', rules.criticalPerAgility)
  for (const stat of data.stats) {
    const precision = stat.unit === 'percent' ? data.percentPrecision : data.flatPrecision
    if (precision !== undefined) totals[stat.id] = roundGameStat(totals[stat.id], precision)
  }
  const maximumHealth = Math.max(0, totals.health ?? 0)
  const maximumMana = Math.max(0, totals.mana ?? 0)
  const currentResources = {
    health: Math.max(0, Math.min(maximumHealth, seed.currentResources?.health ?? maximumHealth)),
    mana: Math.max(0, Math.min(maximumMana, seed.currentResources?.mana ?? maximumMana))
  }
  return {
    characterId: seed.characterId,
    level: seed.level,
    experience: seed.experience,
    freePoints: seed.freePoints,
    baseStats: { ...seed.baseStats },
    allocatedStats: { ...seed.allocatedStats },
    totals,
    breakdown,
    owned: { ...seed.owned },
    equipped: { ...seed.equipped },
    activeTitleId: seed.activeTitleId,
    activeSpecialIds: [...seed.activeSpecialIds],
    learnedSkillIds: [...(seed.learnedSkillIds ?? [])],
    currentResources
  }
}

/** Replay committed past/current events plus only this chapter's uncommitted branch. */
export function gameSnapshot(
  data: GameProjectData,
  characterId: string,
  chapterIndex: number,
  draftChapterId = ''
): GameSnapshot {
  const original = data.characters.find((character) => character.characterId === characterId)
  if (!original) throw new Error('请先为该人物建立游戏数值档案。')
  const seed = copySeed(original)
  const events = data.events
    .filter((event) => !event.orphaned && event.characterId === characterId && event.chapterIndex <= chapterIndex
      && (event.status === 'committed' || event.chapterId === draftChapterId))
    .sort((a, b) => a.chapterIndex - b.chapterIndex || a.order - b.order || a.id.localeCompare(b.id))
  for (const event of events) applyOperation(rulesAtChapter(data, event.chapterIndex), seed, event.operation)
  return toSnapshot(rulesAtChapter(data, chapterIndex), seed)
}

/** Preview with exactly the same rules used during event replay and AI writing. */
export function previewGameOperation(
  data: GameProjectData,
  characterId: string,
  chapterIndex: number,
  draftChapterId: string,
  operation: GameOperation
): GamePreview {
  if (operation.kind === 'equip') {
    const asset = requireAsset(data, operation.assetId)
    const slotId = operation.slotId || asset.slotId
    if (!isGameSlotEnabled(data, slotId)
      || (slotId === 'twohand' && (!isGameSlotEnabled(data, 'mainhand') || !isGameSlotEnabled(data, 'offhand')))) {
      throw new Error('该装备槽已在本作品关闭，请先到槽位设置中启用。')
    }
  }
  const before = gameSnapshot(data, characterId, chapterIndex, draftChapterId)
  const seed: GameCharacterSeed = {
    characterId,
    level: before.level,
    experience: before.experience,
    freePoints: before.freePoints,
    baseStats: { ...before.baseStats },
    allocatedStats: { ...before.allocatedStats },
    owned: { ...before.owned },
    equipped: { ...before.equipped },
    activeTitleId: before.activeTitleId,
    activeSpecialIds: [...before.activeSpecialIds],
    learnedSkillIds: [...before.learnedSkillIds],
    currentResources: { ...before.currentResources }
  }
  const activeRules = rulesAtChapter(data, chapterIndex)
  applyOperation(activeRules, seed, operation)
  const after = toSnapshot(activeRules, seed)
  const delta = Object.fromEntries(data.stats.map((stat) => [stat.id, Number((after.totals[stat.id] - before.totals[stat.id]).toFixed(4))]))
  return { before, after, delta }
}

export function searchGameAssets(
  data: GameProjectData,
  query: string,
  kind?: GameAssetKind,
  limit = 40
): GameAsset[] {
  const term = query.trim().toLocaleLowerCase()
  return data.assets
    .filter((asset) => !kind || asset.kind === kind)
    .filter((asset) => !term || [asset.name, ...asset.aliases, ...asset.tags, asset.slotId, asset.rarity]
      .some((value) => value.toLocaleLowerCase().includes(term)))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, Math.max(1, Math.min(limit, 10000)))
}

export function formatGameSnapshotForWriting(data: GameProjectData, snapshot: GameSnapshot): string {
  const labels = new Map(data.stats.map((stat) => [stat.id, stat.name]))
  const assetName = (id: string): string => data.assets.find((asset) => asset.id === id)?.name ?? id
  const totals = Object.entries(snapshot.totals).map(([id, value]) => `${labels.get(id) ?? id}${value}`).join('、')
  const slotName = (id: string): string => data.slots.find((slot) => slot.id === id)?.name ?? id
  const equipment = Object.entries(snapshot.equipped).map(([slotId, assetId]) => `${slotName(slotId)}:${assetName(assetId)}`).join('、')
  const title = snapshot.activeTitleId ? assetName(snapshot.activeTitleId) : '无'
  const special = snapshot.activeSpecialIds.map(assetName).join('、') || '无'
  const skills = snapshot.learnedSkillIds.map((id) => {
    const skill = data.assets.find((asset) => asset.id === id)
    const detail = skill?.skill
    return `${assetName(id)}(耗蓝${detail?.manaCost ?? 1}${detail?.effect ? `，${detail.effect}` : ''}${detail?.prose ? `，表现:${detail.prose}` : ''})`
  }).join('、') || '无'
  const resources = `生命${snapshot.currentResources.health}/${snapshot.totals.health ?? 0}、魔法${snapshot.currentResources.mana}/${snapshot.totals.mana ?? 0}`
  return `${snapshot.characterId}：等级${snapshot.level}，剩余属性点${snapshot.freePoints}，当前资源[${resources}]，属性[${totals}]，已装备[${equipment || '无'}]，启用称号[${title}]，已激活特殊物品[${special}]，已学技能[${skills}]。数值只能来自本项目已确认目录；未知物品、称号、技能和加成不得编造。`
}

/** Human-readable character sheet for copying into notes or prompts. */
export function formatGameCharacterProfile(data: GameProjectData, snapshot: GameSnapshot, characterName: string): string {
  const assetName = (id: string): string => data.assets.find((asset) => asset.id === id)?.name ?? id
  const lines = [
    `人物：${characterName}`,
    `等级：${snapshot.level}`,
    `经验：${snapshot.experience}`,
    `剩余属性点：${snapshot.freePoints}`,
    `生命值：${snapshot.currentResources.health} / ${snapshot.totals.health ?? 0}`,
    `魔法值：${snapshot.currentResources.mana} / ${snapshot.totals.mana ?? 0}`,
    '属性：',
    ...data.stats.map((stat) => {
      const equipmentBonus = snapshot.breakdown[stat.id]?.reduce((sum, source) => sum + source.value, 0) ?? 0
      return `- ${stat.name}：${snapshot.totals[stat.id] ?? 0}（基础 ${snapshot.baseStats[stat.id] ?? 0}，加点 ${snapshot.allocatedStats[stat.id] ?? 0}，加成 ${equipmentBonus >= 0 ? '+' : ''}${equipmentBonus}）`
    }),
    '装备：',
    ...(Object.entries(snapshot.equipped).length
      ? Object.entries(snapshot.equipped).map(([slotId, assetId]) => `- ${data.slots.find((slot) => slot.id === slotId)?.name ?? slotId}：${assetName(assetId)}`)
      : ['- 无']),
    `称号：${snapshot.activeTitleId ? assetName(snapshot.activeTitleId) : '无'}`,
    `特殊物品：${snapshot.activeSpecialIds.map(assetName).join('、') || '无'}`,
    '技能：',
    ...(snapshot.learnedSkillIds.length
      ? snapshot.learnedSkillIds.map((id) => {
        const skill = data.assets.find((asset) => asset.id === id)
        const detail = skill?.skill
        return `- ${assetName(id)}（消耗魔法 ${detail?.manaCost ?? 1}）${detail?.effect || skill?.description ? `：${detail?.effect || skill?.description}` : ''}${detail?.prose ? `\n  小说表现：${detail.prose}` : ''}`
      })
      : ['- 无'])
  ]
  return lines.join('\n')
}
