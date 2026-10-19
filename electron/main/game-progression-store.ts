import { formatCombatRulesForWriting } from '../shared/game-combat.ts'
import { DEFAULT_COMBAT_RULES, assertCombatRules, assertPrecision, resolveCombat, rulesAtChapter, type CombatInput, type CombatRules } from '../shared/game-combat.ts'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { assertGameTierRules, normalizeGameTierRules, type GameTierRules } from '../shared/game-progression-tiers.ts'
import {
  emptyGameProject,
  emptyGameCharacter,
  completeGameSkillDetails,
  GAME_FLEXIBLE_SLOTS,
  GAME_DEFAULT_STATS,
  GAME_DEFAULT_DERIVED_RULES,
  GAME_EQUIPMENT_SLOTS,
  GAME_TWO_HAND_SLOT,
  gameAssetFitsSlot,
  gameSnapshot,
  isGameSlotEnabled,
  previewGameOperation,
  formatGameSnapshotForWriting,
  type GameAsset,
  type GameCharacterSeed,
  type GameEvent,
  type GameDerivedRules,
  type GameOperation,
  type GameProjectData,
  type GameSlotDefinition,
  type GameStatDefinition
} from '../shared/game-progression.ts'

export type GameCommand =
  | { kind: 'configure'; enabled?: boolean; pointsPerLevel?: number; derivedRules?: GameDerivedRules; tierRules?: GameTierRules; stats?: GameStatDefinition[]; slots?: GameSlotDefinition[] }
  | { kind: 'combat'; chapterId: string; attackerId: string; defenderId: string; input: CombatInput }
  | { kind: 'remove-rule-version'; versionId: string }
  | { kind: 'version-rules'; chapterId: string; derivedRules: GameDerivedRules; flatPrecision: number; percentPrecision: number; combatRules: CombatRules }
  | { kind: 'set-slot-enabled'; slotId: string; enabled: boolean }
  | { kind: 'set-protagonist'; characterId: string }
  | { kind: 'generate-test-data'; characterId: string }
  | { kind: 'upsert-asset'; asset: GameAsset }
  | { kind: 'import-assets'; assets: GameAsset[] }
  | { kind: 'remove-asset'; assetId: string }
  | { kind: 'set-character'; character: GameCharacterSeed }
  | { kind: 'remove-character'; characterId: string }
  | { kind: 'reset-setup' }
  | { kind: 'cleanup-orphans' }
  | { kind: 'stage'; characterId: string; chapterId: string; operation: GameOperation; source?: 'manual' | 'ai'; aiRunId?: string; aiChangeKey?: string; narrativeNote?: string }
  | { kind: 'remove-event'; eventId: string }
  | { kind: 'commit-chapter'; chapterId: string }
  | { kind: 'reopen-chapter'; chapterId: string }

export interface GameProjectRow {
  revision: number
  data: GameProjectData
}

export function initGameProgressionSchema(db: DatabaseSync): void {
  db.exec(`CREATE TABLE IF NOT EXISTS game_progression (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL
  ) STRICT`)
}

export function readGameProject(db: DatabaseSync, projectId: string): GameProjectRow {
  const row = db.prepare('SELECT revision, data_json FROM game_progression WHERE project_id = ?')
    .get(projectId) as { revision: number; data_json: string } | undefined
  return row ? { revision: row.revision, data: normalizeStoredGameProject(JSON.parse(row.data_json) as GameProjectData) }
    : { revision: 0, data: emptyGameProject() }
}

/** Backfill immutable values introduced after v1 archives were already in use. */
function normalizeStoredGameProject(data: GameProjectData): GameProjectData {
  // The original three-slot template was only a coarse placeholder. Translate it
  // without losing catalogue IDs, owned items, or chapter history.
  if (data.slots?.length === 3 && data.slots[0]?.id === 'weapon'
    && data.slots[1]?.id === 'armor' && data.slots[2]?.id === 'accessory') {
    const replacements: Record<string, string> = { weapon: 'mainhand', armor: 'chest', accessory: 'accessory1' }
    data.slots = [...GAME_EQUIPMENT_SLOTS.map((slot) => ({ ...slot })), { ...GAME_TWO_HAND_SLOT },
      ...GAME_FLEXIBLE_SLOTS.map((slot) => ({ ...slot }))]
    for (const asset of data.assets ?? []) asset.slotId = replacements[asset.slotId] ?? asset.slotId
    for (const character of data.characters ?? []) {
      character.equipped = Object.fromEntries(Object.entries(character.equipped)
        .map(([slotId, assetId]) => [replacements[slotId] ?? slotId, assetId]))
    }
    for (const event of data.events ?? []) {
      if (event.operation?.kind === 'unequip') event.operation.slotId = replacements[event.operation.slotId] ?? event.operation.slotId
    }
  }
  const oldDefaultIds = ['attack', 'defense', 'strength', 'agility']
  data.derivedRules = { ...GAME_DEFAULT_DERIVED_RULES, ...(data.derivedRules ?? {}) }
  data.tierRules = normalizeGameTierRules(data.tierRules)
  if (data.stats?.length === oldDefaultIds.length && oldDefaultIds.every((id) => data.stats.some((stat) => stat.id === id))) {
    data.stats = GAME_DEFAULT_STATS.map((stat) => ({ ...stat }))
    for (const character of data.characters ?? []) {
      for (const stat of data.stats) {
        if (character.baseStats[stat.id] === undefined) character.baseStats[stat.id] = stat.id === 'health' ? 100 : stat.id === 'mana' ? 50 : 0
      }
    }
  } else {
    const defaults = new Map(GAME_DEFAULT_STATS.map((stat) => [stat.id, stat]))
    data.stats = (data.stats ?? []).map((stat) => {
      const preset = defaults.get(stat.id)
      return preset ? { ...preset, ...stat, category: stat.category ?? preset.category,
        allocatable: stat.allocatable ?? preset.allocatable, unit: stat.unit ?? preset.unit } : stat
    })
  }
  data.protagonistCharacterId ??= ''
  for (const asset of data.assets ?? []) {
    if (asset.kind === 'skill') asset.skill = completeGameSkillDetails({
      type: asset.skill?.type ?? (asset.tags.includes('战技') ? 'combat' : 'spell'),
      element: asset.skill?.element || '无属性', manaCost: asset.skill?.manaCost ?? 1,
      cooldownSeconds: asset.skill?.cooldownSeconds ?? 0, castTimeSeconds: asset.skill?.castTimeSeconds ?? 0,
      range: asset.skill?.range || '近身', effect: asset.skill?.effect || asset.description, ...asset.skill
    })
  }
  for (const character of data.characters ?? []) {
    character.learnedSkillIds ??= []
    character.currentResources ??= {}
    for (const stat of data.stats ?? []) {
      if (character.baseStats[stat.id] === undefined) character.baseStats[stat.id] = stat.id === 'health' ? 100 : stat.id === 'mana' ? 50 : 0
    }
  }
  for (const event of data.events ?? []) {
    if (event.operation?.kind === 'level-up' && event.operation.pointsGranted === undefined) {
      event.operation.pointsGranted = event.operation.levels * data.pointsPerLevel
    }
  }
  return data
}

/** Promote author-reviewed final chapters during the same workspace transaction. */
export function commitGameEventsForFinalChapters(db: DatabaseSync): void {
  const rows = db.prepare('SELECT project_id, revision, data_json FROM game_progression')
    .all() as Array<{ project_id: string; revision: number; data_json: string }>
  for (const row of rows) {
    const data = normalizeStoredGameProject(JSON.parse(row.data_json) as GameProjectData)
    const chapters = db.prepare('SELECT id, status FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC')
      .all(row.project_id) as Array<{ id: string; status: string }>
    const liveCharacterIds = new Set((db.prepare('SELECT id FROM characters WHERE project_id = ?').all(row.project_id) as Array<{ id: string }>)
      .map((character) => character.id))
    const chapterIndexes = new Map(chapters.map((chapter, index) => [chapter.id, index]))
    const finalIds = new Set(chapters.filter((chapter) => chapter.status === 'final').map((chapter) => chapter.id))
    let changed = false
    const characterCount = data.characters.length
    const eventCount = data.events.length
    data.characters = data.characters.filter((character) => liveCharacterIds.has(character.characterId))
    data.events = data.events.filter((event) => liveCharacterIds.has(event.characterId))
    if (data.characters.length !== characterCount || data.events.length !== eventCount) changed = true
    for (const version of data.ruleVersions ?? []) {
      const index = chapterIndexes.get(version.effectiveChapterId)
      if (index !== undefined && version.chapterIndex !== index) { version.chapterIndex = index; changed = true }
    }
    for (const event of data.events) {
      const index = chapterIndexes.get(event.chapterId)
      const orphaned = index === undefined
      if (Boolean(event.orphaned) !== orphaned || (index !== undefined && event.chapterIndex !== index)) {
        event.orphaned = orphaned
        if (index !== undefined) event.chapterIndex = index
        changed = true
      }
      if (!orphaned && event.status === 'draft' && finalIds.has(event.chapterId)) {
        event.status = 'committed'
        changed = true
      }
    }
    if (changed) {
      validateEventTimeline(data)
      db.prepare('UPDATE game_progression SET revision = revision + 1, data_json = ? WHERE project_id = ?')
        .run(JSON.stringify(data), row.project_id)
    }
  }
}

export function chapterIndexForGame(db: DatabaseSync, projectId: string, chapterId: string): number {
  const chapters = db.prepare('SELECT id FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC')
    .all(projectId) as Array<{ id: string }>
  const index = chapters.findIndex((chapter) => chapter.id === chapterId)
  if (index < 0) throw new Error('章节不存在，无法记录数值变化。')
  return index
}

/** Compact deterministic rules for prose generation; no generated item can become catalogue data. */
export function buildGameWritingContext(
  db: DatabaseSync,
  projectId: string,
  chapterId: string,
  preferredCharacterIds: string[] = []
): string {
  const { data } = readGameProject(db, projectId)
  if (!data.enabled || !chapterId || !data.characters.length) return ''
  let chapterIndex: number
  try { chapterIndex = chapterIndexForGame(db, projectId, chapterId) } catch { return '' }
  const preferred = new Set(preferredCharacterIds)
  const names = new Map((db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(projectId) as Array<{ id: string; name: string }>)
    .map((row) => [row.id, row.name]))
  const characters = data.characters
    .filter((character) => names.has(character.characterId))
    .sort((a, b) => Number(b.characterId === data.protagonistCharacterId) - Number(a.characterId === data.protagonistCharacterId)
      || Number(preferred.has(b.characterId)) - Number(preferred.has(a.characterId)))
    .slice(0, 8)
  if (!characters.length) return ''
  const lines = characters.map((character) => {
    const start = gameSnapshot({ ...data, events: data.events.filter(event => event.chapterId !== chapterId) }, character.characterId, chapterIndex, '')
    const current = gameSnapshot(data, character.characterId, chapterIndex, chapterId)
    const planned = data.events.filter((event) => !event.orphaned && event.characterId === character.characterId
      && event.chapterId === chapterId)
      .sort((a, b) => a.order - b.order)
    const assetName = (id: string): string => data.assets.find((asset) => asset.id === id)?.name ?? id
    const eventText = planned.map((event) => {
      const op = event.operation
      switch (op.kind) {
        case 'level-up': return `升级${op.levels}级`
        case 'allocate': return `${op.statId}加${op.points}点`
        case 'acquire': return `获得${assetName(op.assetId)}×${op.quantity}`
        case 'equip': return `在${data.slots.find((slot) => slot.id === (op.slotId || data.assets.find((asset) => asset.id === op.assetId)?.slotId))?.name ?? '装备槽'}装备或替换为${assetName(op.assetId)}`
        case 'unequip': return `卸下${op.slotId}`
        case 'activate-title': return `启用称号${assetName(op.assetId)}`
        case 'deactivate-title': return '停用称号'
        case 'activate-special': return `激活${assetName(op.assetId)}`
        case 'deactivate-special': return `停用${assetName(op.assetId)}`
        case 'learn-skill': return `学习技能${assetName(op.assetId)}`
        case 'forget-skill': return `遗忘技能${assetName(op.assetId)}`
        case 'use-skill': return `释放技能${assetName(op.assetId)}`
        case 'take-damage': return `承受${op.amount}点伤害`
        case 'restore-resource': return `恢复${op.resourceId === 'health' ? '生命' : '魔法'}${op.amount}点`
        case 'rest': return '休息并恢复生命与魔法'
        case 'consume': return `消耗${assetName(op.assetId)}×${op.quantity}`
      }
    }).map((text, index) => planned[index].narrativeNote ? `${text}（${planned[index].narrativeNote}）` : text).join(' → ')
    return [
      formatGameSnapshotForWriting(data, start).replace(character.characterId, names.get(character.characterId) ?? character.characterId),
      planned.length ? `本章已记录的变化（按剧情先后）：${eventText}` : '本章暂无已记录的数值变化。',
      planned.length ? `本章变化后：${formatGameSnapshotForWriting(data, current).replace(character.characterId, names.get(character.characterId) ?? character.characterId)}` : ''
    ].filter(Boolean).join('\n')
  })
  return `【本作品游戏数值账本】\n${formatCombatRulesForWriting(data, chapterIndex)}\n${lines.join('\n')}\n仅把“本章已记录的变化”写入剧情；未发生前使用起始数值，发生后使用变化后数值。未知装备、称号、等级、点数和加成不得编造；剧情需要但账本未配置时只写动作与感受，不写精确数值。`
}

function assertId(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error(`${label}不能为空或过长。`)
}

function assertDefinitions(definitions: Array<{ id: string; name: string }>, label: string): void {
  if (!Array.isArray(definitions) || definitions.length > 40) throw new Error(`${label}数量无效。`)
  const ids = new Set<string>()
  for (const entry of definitions) {
    assertId(entry.id, label)
    assertId(entry.name, label)
    if (ids.has(entry.id)) throw new Error(`${label} ID 重复：${entry.id}`)
    ids.add(entry.id)
  }
}

function assertStatDefinitions(stats: GameStatDefinition[]): void {
  assertDefinitions(stats, '属性')
  for (const stat of stats) {
    if (stat.category !== undefined && !['primary', 'resource', 'combat', 'special'].includes(stat.category)) throw new Error('属性分类无效。')
    if (stat.allocatable !== undefined && typeof stat.allocatable !== 'boolean') throw new Error('属性加点规则无效。')
    if (stat.unit !== undefined && !['flat', 'percent'].includes(stat.unit)) throw new Error('属性单位无效。')
  }
}

function assertDerivedRules(rules: GameDerivedRules): void {
  const keys = Object.keys(GAME_DEFAULT_DERIVED_RULES) as Array<keyof GameDerivedRules>
  const values = keys.map((key) => rules[key])
  if (Object.keys(rules).length !== keys.length
    || values.some((value) => !Number.isFinite(value) || value < 0 || value > 10000)) throw new Error('属性派生公式无效。')
}

function assertSlotDefinitions(slots: GameSlotDefinition[]): void {
  assertDefinitions(slots, '装备槽')
  if (slots.some((slot) => slot.enabled !== undefined && typeof slot.enabled !== 'boolean')) {
    throw new Error('装备槽启用状态无效。')
  }
}

function assertFiniteStats(values: Record<string, number>, data: GameProjectData): void {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('属性数据格式无效。')
  for (const [statId, value] of Object.entries(values)) {
    if (!data.stats.some((stat) => stat.id === statId) || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000) {
      throw new Error(`属性 ${statId} 未定义或数值无效。`)
    }
  }
}

function assertAsset(asset: GameAsset, data: GameProjectData): void {
  assertId(asset.id, '物品 ID')
  assertId(asset.name, '物品名称')
  if (!['equipment', 'title', 'special', 'skill'].includes(asset.kind)) throw new Error('目录类型无效。')
  if (!['equipped', 'owned', 'active', 'learned'].includes(asset.activation)) throw new Error('生效条件无效。')
  if ((asset.kind === 'equipment' && asset.activation !== 'equipped')
    || (asset.kind === 'title' && asset.activation === 'equipped')
    || (asset.kind === 'skill' && asset.activation !== 'learned')
    || (asset.kind !== 'skill' && asset.activation === 'learned')) throw new Error('该类型不支持所选生效条件。')
  if (!Number.isSafeInteger(asset.levelRequirement) || asset.levelRequirement < 0) throw new Error('装备等级要求无效。')
  if (!Array.isArray(asset.aliases) || !Array.isArray(asset.tags)) throw new Error('别名或标签格式无效。')
  if (!asset.aliases.every((value) => typeof value === 'string') || !asset.tags.every((value) => typeof value === 'string')
    || typeof asset.description !== 'string' || typeof asset.rarity !== 'string'
    || !['manual', 'import'].includes(asset.source)) throw new Error('目录条目字段无效。')
  if ((asset.kind === 'equipment' || asset.activation === 'equipped')
    && !data.slots.some((slot) => slot.id === asset.slotId)) throw new Error('装备槽尚未定义。')
  if (asset.kind === 'skill' && asset.skill) {
    if (!['spell', 'combat', 'movement', 'healing', 'control', 'support'].includes(asset.skill.type)
      || typeof asset.skill.element !== 'string' || typeof asset.skill.range !== 'string' || typeof asset.skill.effect !== 'string'
      || !Number.isSafeInteger(asset.skill.manaCost) || asset.skill.manaCost < 1
      || !Number.isFinite(asset.skill.cooldownSeconds) || asset.skill.cooldownSeconds < 0
      || !Number.isFinite(asset.skill.castTimeSeconds) || asset.skill.castTimeSeconds < 0
      || !['self', 'single', 'line', 'cone', 'area', 'multiple'].includes(asset.skill.target)
      || !['damage', 'healing', 'shield', 'movement', 'control', 'buff', 'debuff', 'summon'].includes(asset.skill.outcome)
      || typeof asset.skill.scalingStatId !== 'string' || !Number.isFinite(asset.skill.powerMultiplier) || asset.skill.powerMultiplier < 0
      || !Number.isFinite(asset.skill.flatPower) || asset.skill.flatPower < 0
      || !Number.isFinite(asset.skill.durationSeconds) || asset.skill.durationSeconds < 0
      || !Number.isSafeInteger(asset.skill.maxStacks) || asset.skill.maxStacks < 1
      || typeof asset.skill.condition !== 'string' || typeof asset.skill.sideEffect !== 'string' || typeof asset.skill.prose !== 'string') throw new Error('技能详情无效。')
  }
  assertFiniteStats(asset.bonuses, data)
}

function assertCharacter(character: GameCharacterSeed, data: GameProjectData): void {
  assertId(character.characterId, '人物 ID')
  if (!Number.isSafeInteger(character.level) || character.level < 1
    || !Number.isSafeInteger(character.freePoints) || character.freePoints < 0
    || !Number.isSafeInteger(character.experience) || character.experience < 0) {
    throw new Error('等级、经验或可用点数无效。')
  }
  assertFiniteStats(character.baseStats, data)
  assertFiniteStats(character.allocatedStats, data)
  if (Object.values(character.allocatedStats).some((value) => value < 0 || !Number.isSafeInteger(value))) {
    throw new Error('已分配属性点必须是非负整数。')
  }
  for (const [assetId, quantity] of Object.entries(character.owned)) {
    if (!data.assets.some((asset) => asset.id === assetId) || !Number.isSafeInteger(quantity) || quantity < 0) {
      throw new Error('初始背包含有未确认物品或无效数量。')
    }
  }
  for (const [slotId, assetId] of Object.entries(character.equipped)) {
    const asset = data.assets.find((entry) => entry.id === assetId)
    if (!data.slots.some((slot) => slot.id === slotId) || !asset || !gameAssetFitsSlot(asset, slotId)
      || slotId === 'ring' || slotId === 'accessory' || !(character.owned[assetId] > 0)) {
      throw new Error('初始装备与已确认目录或背包不一致。')
    }
    if (character.level < asset.levelRequirement) throw new Error(`角色等级不足，无法初始穿戴“${asset.name}”。`)
  }
  for (const [assetId, quantity] of Object.entries(character.owned)) {
    if (Object.values(character.equipped).filter((id) => id === assetId).length > quantity) {
      throw new Error('初始装备数量超过背包拥有数量。')
    }
  }
  if (character.equipped.twohand && (character.equipped.mainhand || character.equipped.offhand)) {
    throw new Error('双手武器不能与主手或副手装备同时穿戴。')
  }
  if (character.activeTitleId) {
    const title = data.assets.find((asset) => asset.id === character.activeTitleId)
    if (!(character.owned[character.activeTitleId] > 0) || title?.kind !== 'title' || title.activation !== 'active') {
      throw new Error('初始称号尚未拥有或类型无效。')
    }
    if (character.level < title.levelRequirement) throw new Error(`角色等级不足，无法初始启用“${title.name}”。`)
  }
  for (const assetId of character.activeSpecialIds) {
    const asset = data.assets.find((entry) => entry.id === assetId)
    if (!(character.owned[assetId] > 0) || asset?.kind !== 'special' || asset.activation !== 'active') {
      throw new Error('初始激活物品尚未拥有或类型无效。')
    }
    if (character.level < asset.levelRequirement) throw new Error(`角色等级不足，无法初始激活“${asset.name}”。`)
  }
  character.learnedSkillIds ??= []
  character.currentResources ??= {}
  if (typeof character.currentResources !== 'object' || Object.entries(character.currentResources)
    .some(([id, value]) => !['health', 'mana'].includes(id) || !Number.isFinite(value) || value < 0)) throw new Error('人物当前生命或魔法无效。')
  if (!Array.isArray(character.learnedSkillIds) || new Set(character.learnedSkillIds).size !== character.learnedSkillIds.length) {
    throw new Error('人物技能列表格式无效或存在重复。')
  }
  for (const assetId of character.learnedSkillIds) {
    const skill = data.assets.find((asset) => asset.id === assetId)
    if (skill?.kind !== 'skill' || skill.activation !== 'learned') throw new Error('人物技能不在已确认技能目录中。')
    if (character.level < skill.levelRequirement) throw new Error(`角色等级不足，无法初始学习“${skill.name}”。`)
  }
}

function assertReferencedAssets(data: GameProjectData, assetId: string): void {
  if (data.characters.some((character) => character.owned[assetId] || character.activeTitleId === assetId
    || character.activeSpecialIds.includes(assetId) || character.learnedSkillIds.includes(assetId)
    || Object.values(character.equipped).includes(assetId))
    || data.events.some((event) => 'assetId' in event.operation && event.operation.assetId === assetId)) {
    throw new Error('该条目已被人物或章节事件使用；请先撤销关联事件，不能直接删除。')
  }
}

function validateEventTimeline(data: GameProjectData): void {
  for (const event of data.events) {
    if (event.orphaned) continue
    if (!data.characters.some((character) => character.characterId === event.characterId)) {
      throw new Error('章节事件引用了不存在的人物档案。')
    }
    gameSnapshot(data, event.characterId, event.chapterIndex, event.chapterId)
  }
}

export function validateImportedGameProject(db: DatabaseSync, projectId: string, candidate: GameProjectData): GameProjectData {
  if (!candidate || candidate.version !== 1 || typeof candidate.enabled !== 'boolean'
    || !Number.isSafeInteger(candidate.pointsPerLevel) || candidate.pointsPerLevel < 0 || candidate.pointsPerLevel > 1000
    || !Array.isArray(candidate.assets) || !Array.isArray(candidate.characters) || !Array.isArray(candidate.events)
    || candidate.assets.length > 10000 || candidate.characters.length > 1000 || candidate.events.length > 100000) {
    throw new Error('归档中的游戏数值数据格式无效。')
  }
  assertStatDefinitions(candidate.stats)
  assertSlotDefinitions(candidate.slots)
  const data = normalizeStoredGameProject(structuredClone(candidate))
  assertDerivedRules(data.derivedRules)
  assertGameTierRules(data.tierRules)
  if (data.protagonistCharacterId && !db.prepare('SELECT 1 FROM characters WHERE project_id = ? AND id = ?')
    .get(projectId, data.protagonistCharacterId)) throw new Error('归档中的主角不属于当前作品。')
  const assetIds = new Set<string>()
  for (const asset of data.assets) {
    assertAsset(asset, data)
    if (assetIds.has(asset.id)) throw new Error('归档中的物品 ID 重复。')
    assetIds.add(asset.id)
  }
  const characterIds = new Set<string>()
  for (const character of data.characters) {
    assertCharacter(character, data)
    if (characterIds.has(character.characterId) || !db.prepare('SELECT 1 FROM characters WHERE project_id = ? AND id = ?')
      .get(projectId, character.characterId)) throw new Error('归档中的人物档案重复或未关联当前项目。')
    characterIds.add(character.characterId)
  }
  const eventIds = new Set<string>()
  for (const event of data.events) {
    assertId(event.id, '事件 ID')
    assertId(event.characterId, '事件人物 ID')
    assertId(event.chapterId, '事件章节 ID')
    if (eventIds.has(event.id) || !['draft', 'committed'].includes(event.status)
      || !['manual', 'ai'].includes(event.source) || !Number.isSafeInteger(event.order) || event.order < 0) {
      throw new Error('归档中的章节数值事件无效或重复。')
    }
    if ((event.aiRunId !== undefined && (typeof event.aiRunId !== 'string' || event.aiRunId.length > 240))
      || (event.aiChangeKey !== undefined && (typeof event.aiChangeKey !== 'string' || event.aiChangeKey.length > 240))
      || (event.narrativeNote !== undefined && (typeof event.narrativeNote !== 'string' || event.narrativeNote.length > 240))) {
      throw new Error('归档中的 AI 运行标识或剧情备注无效。')
    }
    if (!event.operation || typeof event.operation !== 'object'
      || !['level-up', 'allocate', 'acquire', 'equip', 'unequip', 'activate-title', 'deactivate-title', 'activate-special', 'deactivate-special', 'learn-skill', 'forget-skill', 'use-skill', 'take-damage', 'restore-resource', 'rest', 'consume']
        .includes(event.operation.kind)) throw new Error('归档中的数值操作类型无效。')
    eventIds.add(event.id)
    const chapter = db.prepare('SELECT id FROM chapters WHERE project_id = ? AND id = ?')
      .get(projectId, event.chapterId)
    event.orphaned = !chapter
    if (chapter) event.chapterIndex = chapterIndexForGame(db, projectId, event.chapterId)
  }
  if (data.flatPrecision !== undefined) assertPrecision(data.flatPrecision)
  if (data.percentPrecision !== undefined) assertPrecision(data.percentPrecision)
  if (data.combatRules) assertCombatRules(data.combatRules)
  const ruleIds = new Set<string>()
  const ruleChapters = new Set<string>()
  for (const version of data.ruleVersions ?? []) {
    assertId(version.id, '规则版本 ID')
    if (ruleIds.has(version.id) || ruleChapters.has(version.effectiveChapterId)) throw new Error('规则版本重复。')
    ruleIds.add(version.id); ruleChapters.add(version.effectiveChapterId)
    assertDerivedRules(version.derivedRules); assertCombatRules(version.combatRules)
    assertPrecision(version.flatPrecision); assertPrecision(version.percentPrecision)
    assertId(version.effectiveChapterId, '规则生效章节')
    if (!Number.isSafeInteger(version.chapterIndex) || version.chapterIndex < 0) throw new Error('规则生效位置无效。')
    const anchor = db.prepare('SELECT id FROM chapters WHERE project_id = ? AND id = ?').get(projectId, version.effectiveChapterId)
    if (anchor) version.chapterIndex = chapterIndexForGame(db, projectId, version.effectiveChapterId)
  }
  validateEventTimeline(data)
  return data
}

export function applyGameCommand(
  db: DatabaseSync,
  projectId: string,
  expectedRevision: number,
  command: GameCommand
): GameProjectRow {
  assertId(projectId, '作品 ID')
  if (!db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId)) throw new Error('作品不存在。')
  const previous = readGameProject(db, projectId)
  if (previous.revision !== expectedRevision) throw new Error('数值档案已在其他窗口更新，请刷新后重试。')
  const data = structuredClone(previous.data)
  if (command.kind === 'combat') {
    const index = chapterIndexForGame(db, projectId, command.chapterId)
    const rules = rulesAtChapter(data, index)
    const resolution = resolveCombat(gameSnapshot(data, command.attackerId, index, command.chapterId),
      gameSnapshot(data, command.defenderId, index, command.chapterId), rules.combatRules ?? DEFAULT_COMBAT_RULES, command.input)
    if (!resolution.damage) throw new Error('本次没有伤害，无需扣血。')
    command = { kind: 'stage', characterId: command.defenderId, chapterId: command.chapterId,
      operation: { kind: 'take-damage', amount: resolution.damage }, source: 'manual',
      narrativeNote: `战斗试算 ${command.attackerId} → ${command.defenderId}；${command.input.damageType}；命中点数 ${command.input.hitRoll}；暴击点数 ${command.input.criticalRoll}；伤害 ${resolution.damage}` }
  }
  switch (command.kind) {
    case 'configure': {
      if (command.enabled !== undefined) data.enabled = Boolean(command.enabled)
      if (command.pointsPerLevel !== undefined) {
        if (!Number.isSafeInteger(command.pointsPerLevel) || command.pointsPerLevel < 0 || command.pointsPerLevel > 1000) {
          throw new Error('每级属性点必须在 0–1000 之间。')
        }
        data.pointsPerLevel = command.pointsPerLevel
      }
      if (command.derivedRules !== undefined) {
        assertDerivedRules(command.derivedRules)
        if (data.events.length || data.ruleVersions?.length) throw new Error('已有章节记录或规则版本，请通过新规则版本修改派生公式。')
        data.derivedRules = { ...command.derivedRules }
      }
      if (command.tierRules !== undefined) {
        assertGameTierRules(command.tierRules)
        data.tierRules = { ...command.tierRules }
      }
      if (command.stats) {
        assertStatDefinitions(command.stats)
        if (data.assets.length || data.events.length || data.ruleVersions?.length) throw new Error('已有目录、章节记录或规则版本时不能修改属性定义。')
        data.stats = command.stats
        for (const character of data.characters) {
          character.baseStats = Object.fromEntries(command.stats.map((stat) => [stat.id, character.baseStats[stat.id] ?? 0]))
          character.allocatedStats = Object.fromEntries(command.stats
            .filter((stat) => character.allocatedStats[stat.id] !== undefined)
            .map((stat) => [stat.id, character.allocatedStats[stat.id]]))
        }
      }
      if (command.slots) {
        assertSlotDefinitions(command.slots)
        if (data.assets.length || data.events.length) throw new Error('已有目录或章节记录时不能修改装备槽定义。')
        data.slots = command.slots
      }
      break
    }
    case 'remove-rule-version': {
      const version = data.ruleVersions?.find(v => v.id === command.versionId)
      if (!version) throw new Error('规则版本不存在。')
      const chapters = db.prepare('SELECT id, status FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC').all(projectId) as Array<{ id: string; status: string }>
      if (data.events.some(e => !e.orphaned && e.chapterIndex >= version.chapterIndex)
        || chapters.some((c,index) => index >= version.chapterIndex && c.status === 'final')
        || data.ruleVersions?.some(v => v.chapterIndex > version.chapterIndex)) throw new Error('规则已被使用或存在后续版本，不能删除。')
      data.ruleVersions = data.ruleVersions!.filter(v => v.id !== version.id)
      break
    }
    case 'version-rules': {
      assertDerivedRules(command.derivedRules)
      assertCombatRules(command.combatRules)
      assertPrecision(command.flatPrecision)
      assertPrecision(command.percentPrecision)
      const chapterIndex = chapterIndexForGame(db, projectId, command.chapterId)
      const chapter = db.prepare('SELECT status FROM chapters WHERE project_id = ? AND id = ?').get(projectId, command.chapterId) as { status: string }
      if (chapter.status === 'final') throw new Error('规则不能从已定稿章节开始生效。')
      if (data.events.some(event => !event.orphaned && event.chapterIndex >= chapterIndex)) throw new Error('本章或后续章节已有数值记录，请选择尚无记录的后续章节。')
      const laterFinal = db.prepare('SELECT id, status FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC').all(projectId) as Array<{ id: string; status: string }>
      if (laterFinal.some((entry,index) => index >= chapterIndex && entry.status === 'final')) throw new Error('本章或后续章节已定稿，不能修改其生效规则。')
      if ((data.ruleVersions ?? []).some(version => version.chapterIndex > chapterIndex)) throw new Error('存在后续规则版本，不能修改更早的规则。')
      const existing = data.ruleVersions?.find(v => v.effectiveChapterId === command.chapterId)
      data.ruleVersions = data.ruleVersions?.filter(v => v.id !== existing?.id)
      data.ruleVersions = [...(data.ruleVersions ?? []), { id: existing?.id ?? randomUUID(), effectiveChapterId: command.chapterId,
        chapterIndex, derivedRules: { ...command.derivedRules }, flatPrecision: command.flatPrecision,
        percentPrecision: command.percentPrecision, combatRules: { ...command.combatRules } }]
      break
    }
    case 'set-slot-enabled': {
      const slot = data.slots.find((entry) => entry.id === command.slotId)
      if (!slot || typeof command.enabled !== 'boolean') throw new Error('装备槽设置无效。')
      if (!command.enabled) {
        const chapters = db.prepare('SELECT id FROM chapters WHERE project_id = ? ORDER BY sort_order ASC, rowid ASC')
          .all(projectId) as Array<{ id: string }>
        const current = chapters.at(-1)
        const occupied = data.characters.some((character) => {
          const equipped = current
            ? gameSnapshot(data, character.characterId, chapters.length - 1, current.id).equipped
            : character.equipped
          return Boolean(equipped[slot.id]
            || ((slot.id === 'mainhand' || slot.id === 'offhand') && equipped.twohand))
        })
        if (occupied) throw new Error('此槽位在最新章节仍有已穿戴装备；请先卸下并确认章节变化，再关闭槽位。')
      }
      slot.enabled = command.enabled
      break
    }
    case 'set-protagonist': {
      if (command.characterId && !db.prepare('SELECT 1 FROM characters WHERE project_id = ? AND id = ?')
        .get(projectId, command.characterId)) throw new Error('主角不属于当前作品。')
      data.protagonistCharacterId = command.characterId
      break
    }
    case 'generate-test-data': {
      if (data.assets.length || data.events.length) throw new Error('已有物品目录或章节数值记录，不能生成测试数据，以免混入真实作品。')
      if (!db.prepare('SELECT 1 FROM characters WHERE project_id = ? AND id = ?').get(projectId, command.characterId)) {
        throw new Error('请先选择当前作品中的人物。')
      }
      const bonuses = (...entries: Array<[string, number]>): Record<string, number> => Object.fromEntries(entries
        .filter(([id]) => data.stats.some((stat) => stat.id === id)))
      const assets: GameAsset[] = [
        { id: 'demo-flame-blade', kind: 'equipment', name: '试炼炎刃', aliases: ['测试剑'], description: '用于测试主手换装和属性变化。', rarity: '稀有', tags: ['测试', '火系'], slotId: 'mainhand', activation: 'equipped', levelRequirement: 1, bonuses: bonuses(['attack', 8], ['strength', 2]), source: 'manual' },
        { id: 'demo-guard-armor', kind: 'equipment', name: '守卫胸甲', aliases: [], description: '用于测试胸甲的生命与防御加成。', rarity: '精良', tags: ['测试'], slotId: 'chest', activation: 'equipped', levelRequirement: 1, bonuses: bonuses(['health', 30], ['defense', 10], ['constitution', 2]), source: 'manual' },
        { id: 'demo-wind-boots', kind: 'equipment', name: '踏风靴', aliases: [], description: '用于测试脚部装备和敏捷加成。', rarity: '精良', tags: ['测试', '风系'], slotId: 'feet', activation: 'equipped', levelRequirement: 1, bonuses: bonuses(['agility', 3], ['speed', 2]), source: 'manual' },
        { id: 'demo-power-ring', kind: 'equipment', name: '力量指环', aliases: [], description: '同一类戒指可以选择戒指一或戒指二。', rarity: '普通', tags: ['测试'], slotId: 'ring', activation: 'equipped', levelRequirement: 1, bonuses: bonuses(['strength', 2]), source: 'manual' },
        { id: 'demo-title', kind: 'title', name: '初试锋芒', aliases: [], description: '测试用称号。', rarity: '普通', tags: ['测试'], slotId: '', activation: 'active', levelRequirement: 1, bonuses: bonuses(['attack', 2]), source: 'manual' },
        { id: 'demo-token', kind: 'special', name: '试炼徽记', aliases: [], description: '持有时提供少量防御。', rarity: '普通', tags: ['测试'], slotId: '', activation: 'owned', levelRequirement: 1, bonuses: bonuses(['defense', 2]), source: 'manual' },
        { id: 'demo-fireball', kind: 'skill', name: '火球术', aliases: [], description: '凝聚火元素并射向目标，造成火焰伤害。', rarity: '基础', tags: ['测试', '法术', '火系'], slotId: '', activation: 'learned', levelRequirement: 1, bonuses: {}, source: 'manual', skill: completeGameSkillDetails({ type: 'spell', element: '火', manaCost: 12, cooldownSeconds: 4, castTimeSeconds: 1, range: '中距离', effect: '造成 25 + 法术强度×1.2 的火焰伤害。', flatPower: 25, powerMultiplier: 1.2, prose: '火光在掌心压缩成球，脱手后拖着炽热尾焰撞向目标。' }) },
        { id: 'demo-wind-step', kind: 'skill', name: '疾风步', aliases: [], description: '短时间提高移动速度，用于追击或脱离。', rarity: '进阶', tags: ['测试', '战技', '风系'], slotId: '', activation: 'learned', levelRequirement: 5, bonuses: {}, source: 'manual', skill: completeGameSkillDetails({ type: 'movement', outcome: 'movement', target: 'self', element: '风', manaCost: 8, cooldownSeconds: 6, castTimeSeconds: 0, range: '自身', effect: '瞬间移动一段距离，并在 3 秒内提高速度。', durationSeconds: 3, prose: '脚下风流骤然托起身体，人已从对手的视线里横移出去。' }) },
        { id: 'demo-insight', kind: 'skill', name: '弱点洞察', aliases: [], description: '观察目标动作，识别防御薄弱位置。', rarity: '精良', tags: ['测试', '辅助'], slotId: '', activation: 'learned', levelRequirement: 3, bonuses: {}, source: 'manual', skill: completeGameSkillDetails({ type: 'support', outcome: 'buff', element: '无属性', manaCost: 5, cooldownSeconds: 3, castTimeSeconds: 0, range: '中距离', effect: '识别目标的防御薄弱位置，下一次攻击更容易命中。', condition: '需要能清晰观察目标动作', prose: '视线略过对手的肩、腰与脚步，一处节奏破绽在眼中变得清晰。' }) }
      ]
      for (const asset of assets) assertAsset(asset, data)
      data.assets = assets
      const seed = emptyGameCharacter(command.characterId, data)
      seed.level = 8
      seed.freePoints = 10
      const demoBase: Record<string, number> = { health: 100, mana: 60, strength: 12, agility: 10, intelligence: 14, constitution: 10 }
      data.stats.forEach((stat) => { seed.baseStats[stat.id] = demoBase[stat.id] ?? 0 })
      seed.owned = Object.fromEntries(assets.filter((asset) => asset.kind !== 'skill').map((asset) => [asset.id, asset.id === 'demo-power-ring' ? 2 : 1]))
      seed.equipped = { mainhand: 'demo-flame-blade', chest: 'demo-guard-armor', feet: 'demo-wind-boots', ring1: 'demo-power-ring' }
      seed.activeTitleId = 'demo-title'
      seed.learnedSkillIds = ['demo-fireball', 'demo-wind-step']
      const existingIndex = data.characters.findIndex((character) => character.characterId === command.characterId)
      if (existingIndex >= 0) data.characters[existingIndex] = seed
      else data.characters.push(seed)
      data.protagonistCharacterId = command.characterId
      data.enabled = true
      break
    }
    case 'upsert-asset': {
      assertAsset(command.asset, data)
      const existingIndex = data.assets.findIndex((asset) => asset.id === command.asset.id)
      if (existingIndex >= 0) {
        const previousAsset = data.assets[existingIndex]
        if (JSON.stringify(previousAsset) !== JSON.stringify(command.asset)) assertReferencedAssets(data, command.asset.id)
        data.assets[existingIndex] = command.asset
      } else data.assets.push(command.asset)
      break
    }
    case 'import-assets': {
      if (!Array.isArray(command.assets) || command.assets.length > 2000) throw new Error('单次最多导入 2000 条目录数据。')
      const importedIds = new Set<string>()
      for (const asset of command.assets) {
        assertAsset(asset, data)
        if (importedIds.has(asset.id)) throw new Error(`导入表中物品 ID 重复：${asset.id}`)
        importedIds.add(asset.id)
        const existingIndex = data.assets.findIndex((entry) => entry.id === asset.id)
        if (existingIndex >= 0) {
          const previousAsset = data.assets[existingIndex]
          if (JSON.stringify(previousAsset) !== JSON.stringify(asset)) assertReferencedAssets(data, asset.id)
          data.assets[existingIndex] = asset
        } else data.assets.push(asset)
      }
      break
    }
    case 'remove-asset': {
      assertReferencedAssets(data, command.assetId)
      data.assets = data.assets.filter((asset) => asset.id !== command.assetId)
      break
    }
    case 'set-character': {
      assertCharacter(command.character, data)
      for (const slotId of Object.keys(command.character.equipped)) {
        if (!isGameSlotEnabled(data, slotId)
          || (slotId === 'twohand' && (!isGameSlotEnabled(data, 'mainhand') || !isGameSlotEnabled(data, 'offhand')))) {
          throw new Error('初始装备使用了已关闭的槽位。')
        }
      }
      if (command.character.equipped.twohand && (command.character.equipped.mainhand || command.character.equipped.offhand)) {
        throw new Error('双手武器不能与主手或副手装备同时穿戴。')
      }
      if (!db.prepare('SELECT 1 FROM characters WHERE project_id = ? AND id = ?').get(projectId, command.character.characterId)) {
        throw new Error('人物不在当前作品中。')
      }
      const existingIndex = data.characters.findIndex((character) => character.characterId === command.character.characterId)
      if (existingIndex >= 0) {
        const changed = JSON.stringify(data.characters[existingIndex]) !== JSON.stringify(command.character)
        if (changed && data.events.some((event) => event.characterId === command.character.characterId)) {
          throw new Error('该人物已有章节数值记录，不能再改写初始档案；请用当前章节变化修正。')
        }
        data.characters[existingIndex] = command.character
      }
      else data.characters.push(command.character)
      break
    }
    case 'remove-character': {
      assertId(command.characterId, '人物 ID')
      data.characters = data.characters.filter((character) => character.characterId !== command.characterId)
      data.events = data.events.filter((event) => event.characterId !== command.characterId)
      if (data.protagonistCharacterId === command.characterId) data.protagonistCharacterId = ''
      break
    }
    case 'reset-setup': {
      if (data.events.length) throw new Error('已有章节数值记录，不能直接重置；请先逐章处理或删除相关档案。')
      const reset = emptyGameProject()
      reset.enabled = data.enabled
      Object.assign(data, reset)
      break
    }
    case 'cleanup-orphans': {
      data.events = data.events.filter((event) => !event.orphaned)
      break
    }
    case 'stage': {
      if (!data.enabled) throw new Error('请先启用本作品的游戏数值功能。')
      if (command.source === 'ai' && command.aiRunId && command.aiChangeKey) {
        const duplicate = data.events.find((event) => event.status === 'draft' && event.source === 'ai'
          && event.aiRunId === command.aiRunId && event.aiChangeKey === command.aiChangeKey)
        if (duplicate) return previous
      }
      const chapterIndex = chapterIndexForGame(db, projectId, command.chapterId)
      const chapter = db.prepare('SELECT status FROM chapters WHERE project_id = ? AND id = ?')
        .get(projectId, command.chapterId) as { status: string }
      if (chapter.status === 'final') throw new Error('该章已定稿；如需补录数值，请先将章节退回草稿。')
      const operation: GameOperation = command.operation.kind === 'level-up'
        ? { ...command.operation, pointsGranted: command.operation.pointsGranted ?? command.operation.levels * data.pointsPerLevel }
        : command.operation
      previewGameOperation(data, command.characterId, chapterIndex, command.chapterId, operation)
      const event: GameEvent = {
        id: randomUUID(), characterId: command.characterId, chapterId: command.chapterId, chapterIndex,
        order: Math.max(0, ...data.events.filter((entry) => entry.chapterId === command.chapterId).map((entry) => entry.order)) + 1,
        status: 'draft', operation, source: command.source === 'ai' ? 'ai' : 'manual',
        ...(command.aiRunId ? { aiRunId: command.aiRunId } : {}),
        ...(command.aiChangeKey ? { aiChangeKey: command.aiChangeKey } : {}),
        ...(command.narrativeNote?.trim() ? { narrativeNote: command.narrativeNote.trim().slice(0, 240) } : {}),
        createdAt: new Date().toISOString()
      }
      data.events.push(event)
      break
    }
    case 'remove-event': {
      const event = data.events.find((entry) => entry.id === command.eventId)
      if (!event) throw new Error('变更记录不存在。')
      if (event.status === 'committed') throw new Error('已确认的历史不能直接撤销，请创建后续章节中的反向变更。')
      data.events = data.events.filter((entry) => entry.id !== command.eventId)
      break
    }
    case 'commit-chapter': {
      chapterIndexForGame(db, projectId, command.chapterId)
      for (const event of data.events) if (event.chapterId === command.chapterId) event.status = 'committed'
      break
    }
    case 'reopen-chapter': {
      chapterIndexForGame(db, projectId, command.chapterId)
      const chapter = db.prepare('SELECT status FROM chapters WHERE project_id = ? AND id = ?')
        .get(projectId, command.chapterId) as { status: string }
      if (chapter.status === 'final') throw new Error('请先将章节状态退出“定稿”，再回退本章数值。')
      for (const event of data.events) if (event.chapterId === command.chapterId) event.status = 'draft'
      break
    }
  }
  validateEventTimeline(data)
  const nextRevision = previous.revision + 1
  const update = db.prepare(`INSERT INTO game_progression (project_id, revision, data_json) VALUES (?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, data_json = excluded.data_json
    WHERE game_progression.revision = ?`).run(projectId, nextRevision, JSON.stringify(data), expectedRevision)
  if (update.changes !== 1) throw new Error('数值档案版本冲突，请刷新后重试。')
  return { revision: nextRevision, data }
}

function persistGameData(db: DatabaseSync, projectId: string, row: GameProjectRow, data: GameProjectData): GameProjectRow {
  const nextRevision = row.revision + 1
  const update = db.prepare('UPDATE game_progression SET revision = ?, data_json = ? WHERE project_id = ? AND revision = ?')
    .run(nextRevision, JSON.stringify(data), projectId, row.revision)
  if (update.changes !== 1) throw new Error('数值档案版本冲突，请刷新后重试。')
  return { revision: nextRevision, data }
}

/** Remove every still-draft side effect produced by a failed/canceled AI run. */
export function rollbackAiGameRun(db: DatabaseSync, projectId: string, aiRunId: string): GameProjectRow {
  const row = readGameProject(db, projectId)
  const events = row.data.events.filter((event) => !(event.status === 'draft' && event.source === 'ai' && event.aiRunId === aiRunId))
  if (events.length === row.data.events.length) return row
  return persistGameData(db, projectId, row, { ...row.data, events })
}

/** Starting a fresh first draft replaces unconfirmed AI changes left by an older draft. */
export function clearAiDraftEventsForChapter(db: DatabaseSync, projectId: string, chapterId: string): GameProjectRow {
  const row = readGameProject(db, projectId)
  const events = row.data.events.filter((event) => !(event.status === 'draft' && event.source === 'ai' && event.chapterId === chapterId))
  if (events.length === row.data.events.length) return row
  return persistGameData(db, projectId, row, { ...row.data, events })
}
