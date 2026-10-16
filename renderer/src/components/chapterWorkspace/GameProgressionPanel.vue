<script setup lang="ts">
import GameRulesEditor from './GameRulesEditor.vue'
import GameCombatPreview from './GameCombatPreview.vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { NSelect, NTooltip, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import {
  emptyGameCharacter,
  formatGameCharacterProfile,
  gameAssetFitsSlot,
  gameSnapshot,
  isGameSlotEnabled,
  searchGameAssets,
  type GameAsset,
  type GameActivation,
  type GameAssetKind,
  type GameCharacterSeed,
  type GameOperation,
  type GamePreview,
  type GameSnapshot
} from '@shared/game-progression'
import { GAME_DEFAULT_TIER_RULES, type GameTierRules } from '@shared/game-progression-tiers'
import type { GameCommand, GameProjectRow } from '../../../../electron/main/game-progression-store'
import type { AssistantEventPush } from '@shared/assistant-runtime'

const appStore = useAppStore()
const message = useMessage()
const row = ref<GameProjectRow | null>(null)
const snapshot = ref<GameSnapshot | null>(null)
const characterId = ref('')
const query = ref('')
const catalogPage = ref(1)
const catalogMinLevel = ref<number | null>(null)
const catalogMaxLevel = ref<number | null>(null)
const catalogSlot = ref('')
const CATALOG_PAGE_SIZE = 40
const activeSlotId = ref('')
const slotQuery = ref('')
const skillQuery = ref('')
const kind = ref<GameAssetKind | ''>('')
const selectedAssetId = ref('')
const equipTargetSlot = ref('ring1')
const itemQuantity = ref(1)
const levelCount = ref(1)
const points = ref(1)
const resourceAmount = ref(10)
const statId = ref('')
const pendingOperation = ref<GameOperation | null>(null)
const preview = ref<GamePreview | null>(null)
const narrativeNote = ref('')
const busy = ref(false)
const seedDraft = ref<GameCharacterSeed | null>(null)
const importPreview = ref<{ fileName: string; assets: GameAsset[] } | null>(null)
const pointsPerLevel = ref(5)
const tierRules = ref<GameTierRules>({ ...GAME_DEFAULT_TIER_RULES })
const statDefinitions = ref('')
const slotDefinitions = ref('')
const editingAssetId = ref('')
const assetName = ref('')
const assetKind = ref<GameAssetKind>('equipment')
const assetSlot = ref('mainhand')
const assetActivation = ref<GameActivation>('equipped')
const assetBonuses = ref<Record<string, number>>({})
const assetLevelRequirement = ref(0)
const assetAliases = ref('')
const assetTags = ref('')
const assetRarity = ref('')
const assetDescription = ref('')
const assetSkillType = ref<'spell' | 'combat' | 'movement' | 'healing' | 'control' | 'support'>('spell')
const assetElement = ref('无属性')
const assetManaCost = ref(1)
const assetCooldown = ref(0)
const assetCastTime = ref(0)
const assetRange = ref('近身')
const assetEffect = ref('')
const assetSkillOutcome = ref<'damage' | 'healing' | 'shield' | 'movement' | 'control' | 'buff' | 'debuff' | 'summon'>('damage')
const assetSkillTarget = ref<'self' | 'single' | 'line' | 'cone' | 'area' | 'multiple'>('single')
const assetScalingStatId = ref('spellPower')
const assetPowerMultiplier = ref(1)
const assetFlatPower = ref(0)
const assetDuration = ref(0)
const assetCondition = ref('')
const assetSideEffect = ref('')
const assetProse = ref('')
const characterOptions = computed(() => [
  { label: '选择人物', value: '' },
  ...appStore.characters.map((character) => ({ label: character.name, value: character.id }))
])
const statOptions = computed(() => row.value?.data.stats.filter((stat) => stat.allocatable !== false).map((stat) => ({ label: stat.name, value: stat.id })) ?? [])
const slotOptions = computed(() => row.value?.data.slots.map((slot) => ({ label: slot.name, value: slot.id })) ?? [])
const visibleSlots = computed(() => row.value?.data.slots.filter((slot) => !['twohand', 'ring', 'accessory'].includes(slot.id)) ?? [])
const configurableSlots = computed(() => row.value?.data.slots.filter((slot) => slot.id !== 'ring' && slot.id !== 'accessory') ?? [])
const boardCharacter = computed(() => !row.value?.data.protagonistCharacterId || row.value.data.protagonistCharacterId === characterId.value)
const activeSlot = computed(() => row.value?.data.slots.find((slot) => slot.id === activeSlotId.value))
const slotCandidates = computed(() => {
  if (!row.value || !snapshot.value || !activeSlotId.value) return []
  const handSlot = activeSlotId.value === 'mainhand' || activeSlotId.value === 'offhand'
  const term = slotQuery.value.trim().toLocaleLowerCase()
  return row.value.data.assets
    .filter((asset) => (asset.kind === 'equipment' || asset.activation === 'equipped')
      && (gameAssetFitsSlot(asset, activeSlotId.value) || (handSlot && asset.slotId === 'twohand'
        && isGameSlotEnabled(row.value!.data, 'twohand')
        && isGameSlotEnabled(row.value!.data, 'mainhand')
        && isGameSlotEnabled(row.value!.data, 'offhand'))))
    .filter((asset) => !term || [asset.name, ...asset.aliases, ...asset.tags, asset.rarity]
      .some((value) => value.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number((snapshot.value!.owned[b.id] ?? 0) > 0) - Number((snapshot.value!.owned[a.id] ?? 0) > 0)
      || a.name.localeCompare(b.name, 'zh-CN'))
})
const filterKindOptions = [
  { label: '全部', value: '' },
  { label: '装备', value: 'equipment' },
  { label: '称号', value: 'title' },
  { label: '特殊物品', value: 'special' },
  { label: '技能', value: 'skill' }
]
const assetKindOptions = filterKindOptions.slice(1)
const skillTypeOptions = [
  { label: '法术', value: 'spell' }, { label: '战技', value: 'combat' }, { label: '身法', value: 'movement' },
  { label: '治疗', value: 'healing' }, { label: '控制', value: 'control' }, { label: '辅助', value: 'support' }
]
const skillOutcomeOptions = [
  { label: '伤害', value: 'damage' }, { label: '治疗', value: 'healing' }, { label: '护盾', value: 'shield' },
  { label: '位移', value: 'movement' }, { label: '控制', value: 'control' }, { label: '增益', value: 'buff' },
  { label: '减益', value: 'debuff' }, { label: '召唤', value: 'summon' }
]
const skillTargetOptions = [
  { label: '自身', value: 'self' }, { label: '单体', value: 'single' }, { label: '直线', value: 'line' },
  { label: '扇形', value: 'cone' }, { label: '范围', value: 'area' }, { label: '多目标', value: 'multiple' }
]
const activationOptions = computed(() => [
  ...(assetKind.value === 'skill' ? [{ label: '学习即掌握', value: 'learned' }] : []),
  { label: '启用生效', value: 'active' },
  { label: '持有生效', value: 'owned' },
  ...(assetKind.value === 'special' ? [{ label: '装备生效', value: 'equipped' }] : [])
])
const matchingAssets = computed(() => row.value
  ? searchGameAssets(row.value.data, query.value, kind.value || undefined, row.value.data.assets.length || 1)
    .filter((asset) => !catalogSlot.value || asset.slotId === catalogSlot.value)
    .filter((asset) => typeof catalogMinLevel.value !== 'number' || !Number.isFinite(catalogMinLevel.value) || asset.levelRequirement >= catalogMinLevel.value)
    .filter((asset) => typeof catalogMaxLevel.value !== 'number' || !Number.isFinite(catalogMaxLevel.value) || asset.levelRequirement <= catalogMaxLevel.value)
  : [])
const catalogPageCount = computed(() => Math.max(1, Math.ceil(matchingAssets.value.length / CATALOG_PAGE_SIZE)))
const searchResults = computed(() => matchingAssets.value.slice((catalogPage.value - 1) * CATALOG_PAGE_SIZE, catalogPage.value * CATALOG_PAGE_SIZE))
watch([query, kind, catalogMinLevel, catalogMaxLevel, catalogSlot], () => { catalogPage.value = 1 })
watch(catalogPageCount, (count) => { if (catalogPage.value > count) catalogPage.value = count })
const selectedAsset = computed(() => row.value?.data.assets.find((asset) => asset.id === selectedAssetId.value))
const learnedSkills = computed(() => snapshot.value?.learnedSkillIds
  .map((id) => row.value?.data.assets.find((asset) => asset.id === id))
  .filter((asset): asset is GameAsset => Boolean(asset)) ?? [])
const skillCandidates = computed(() => {
  const term = skillQuery.value.trim().toLocaleLowerCase()
  return row.value?.data.assets.filter((asset) => asset.kind === 'skill')
    .filter((asset) => !term || [asset.name, ...asset.aliases, ...asset.tags, asset.description]
      .some((value) => value.toLocaleLowerCase().includes(term))) ?? []
})
const flexibleTargetOptions = computed(() => selectedAsset.value?.slotId === 'ring'
  ? [{ label: '戒指一', value: 'ring1' }, { label: '戒指二', value: 'ring2' }]
  : selectedAsset.value?.slotId === 'accessory'
    ? [{ label: '饰品一', value: 'accessory1' }, { label: '饰品二', value: 'accessory2' }] : [])
const chapterEvents = computed(() => row.value?.data.events.filter((event) => event.chapterId === appStore.selectedChapter?.id) ?? [])
const selectedCharacterHasEvents = computed(() => row.value?.data.events.some((event) => event.characterId === characterId.value) ?? false)
const rulesEditable = computed(() => !row.value?.data.assets.length && !row.value?.data.events.length && !row.value?.data.ruleVersions?.length)
const statGroups = computed(() => {
  const stats = row.value?.data.stats ?? []
  return [
    { id: 'primary', name: '基础属性', stats: stats.filter((stat) => stat.category === 'primary' || stat.category === undefined) },
    { id: 'combat', name: '战斗属性', stats: stats.filter((stat) => stat.category === 'combat') },
    { id: 'special', name: '特殊属性', stats: stats.filter((stat) => stat.category === 'special') }
  ].filter((group) => group.stats.length)
})
const orphanCount = computed(() => row.value?.data.events.filter((event) => event.orphaned).length ?? 0)
const canGenerateTestData = computed(() => Boolean(row.value && characterId.value
  && !row.value.data.assets.length && !row.value.data.events.length))
const nameFor = (id: string): string => row.value?.data.assets.find((asset) => asset.id === id)?.name ?? id
const statName = (id: string): string => row.value?.data.stats.find((stat) => stat.id === id)?.name ?? id
const slotName = (id: string): string => row.value?.data.slots.find((slot) => slot.id === id)?.name ?? id
const characterName = (id: string): string => appStore.characters.find((character) => character.id === id)?.name ?? id
const assetKindName = (asset: GameAsset): string => asset.kind === 'equipment' ? '装备'
  : asset.kind === 'title' ? '称号' : asset.kind === 'skill' ? '技能' : '特殊物品'
const equippedAssetFor = (slotId: string): GameAsset | undefined => {
  const assetId = snapshot.value?.equipped[slotId]
    ?? ((slotId === 'mainhand' || slotId === 'offhand') ? snapshot.value?.equipped.twohand : undefined)
  return row.value?.data.assets.find((asset) => asset.id === assetId)
}
const bonusText = (asset: GameAsset): string => Object.entries(asset.bonuses)
  .filter(([, value]) => value !== 0)
  .map(([id, value]) => `${statName(id)} ${value >= 0 ? '+' : ''}${value}`).join(' · ') || '无数值加成'
const statBonus = (id: string): number => snapshot.value?.breakdown[id]?.reduce((sum, source) => sum + source.value, 0) ?? 0
const skillTypeName = (asset: GameAsset): string => skillTypeOptions.find((option) => option.value === asset.skill?.type)?.label ?? '技能'
const canUseSkill = (asset: GameAsset): boolean => Boolean(snapshot.value
  && (snapshot.value.currentResources.mana ?? 0) >= (asset.skill?.manaCost ?? 1))
let stopLegacyEvents: (() => void) | null = null
let stopAssistantEvents: (() => void) | null = null
const legacyGameStreams = new Set<string>()
const assistantGameCalls = new Set<string>()
const assistantGameTurns = new Set<string>()

async function refresh(): Promise<void> {
  const projectId = appStore.selectedProjectId
  if (!projectId) return
  const result = await window.characterArc.gameRead(projectId)
  if (!result.success || !result.result) { message.error(result.error || '读取数值档案失败'); return }
  row.value = result.result
  pointsPerLevel.value = row.value.data.pointsPerLevel
  tierRules.value = { ...row.value.data.tierRules }
  statDefinitions.value = row.value.data.stats.map((entry) => `${entry.id}:${entry.name}`).join('，')
  slotDefinitions.value = row.value.data.slots.map((entry) => `${entry.id}:${entry.name}`).join('，')
  if (!appStore.characters.some((character) => character.id === characterId.value)) {
    characterId.value = appStore.characters.find((character) => character.id === row.value?.data.protagonistCharacterId)?.id
      ?? appStore.characters[0]?.id ?? ''
  }
  if (!statOptions.value.some((option) => option.value === statId.value)) statId.value = statOptions.value[0]?.value ?? ''
  if (!row.value.data.slots.some((slot) => slot.id === assetSlot.value)) assetSlot.value = row.value.data.slots[0]?.id ?? ''
  await refreshSnapshot()
}

async function refreshSnapshot(): Promise<void> {
  pendingOperation.value = null
  preview.value = null
  const id = characterId.value
  if (!id || !row.value?.data.characters.some((entry) => entry.characterId === id)) {
    snapshot.value = null
    seedDraft.value = null
    return
  }
  if (appStore.selectedChapter?.id) {
    const result = await window.characterArc.gameSnapshot({ projectId: appStore.selectedProjectId, characterId: id, chapterId: appStore.selectedChapter.id })
    if (!result.success || !result.result) { message.error(result.error || '读取角色数值失败'); return }
    snapshot.value = result.result
  } else snapshot.value = gameSnapshot(row.value.data, id, -1)
  seedDraft.value = toIpcPayload(row.value.data.characters.find((entry) => entry.characterId === id)!)
}

async function command(next: GameCommand): Promise<boolean> {
  if (!row.value || busy.value) return false
  busy.value = true
  try {
    const result = await window.characterArc.gameCommand({ projectId: appStore.selectedProjectId, expectedRevision: row.value.revision, command: toIpcPayload(next) })
    if (!result.success || !result.result) { message.error(result.error || '保存失败'); await refresh(); return false }
    row.value = result.result
    await refreshSnapshot()
    return true
  } finally { busy.value = false }
}

async function createCharacter(): Promise<void> {
  if (!row.value || !characterId.value) return
  if (await command({ kind: 'set-character', character: emptyGameCharacter(characterId.value, row.value.data) })) message.success('人物数值档案已建立')
}

async function setProtagonist(): Promise<void> {
  if (!characterId.value) return
  if (await command({ kind: 'set-protagonist', characterId: characterId.value })) message.success('已设为本作品主角')
}

async function generateTestData(): Promise<void> {
  if (!canGenerateTestData.value || !characterId.value) return
  if (!window.confirm(`为“${characterName(characterId.value)}”生成装备、称号、特殊物品和 3 个技能的测试数据？不会修改正文。`)) return
  if (await command({ kind: 'generate-test-data', characterId: characterId.value })) message.success('测试数据已生成，可以直接换装、加点、学习技能和复制人物信息')
}

async function learnSkill(asset: GameAsset): Promise<void> {
  if (asset.kind !== 'skill' || snapshot.value?.learnedSkillIds.includes(asset.id)) return
  if (snapshot.value && snapshot.value.level < asset.levelRequirement) { message.warning('人物等级不足，无法学习该技能'); return }
  if (!appStore.selectedChapter?.id) {
    if (!seedDraft.value || selectedCharacterHasEvents.value) { message.warning('请先选择章节'); return }
    const next = toIpcPayload(seedDraft.value)
    next.learnedSkillIds ??= []
    if (!next.learnedSkillIds.includes(asset.id)) next.learnedSkillIds.push(asset.id)
    if (await command({ kind: 'set-character', character: next })) message.success('技能已加入人物初始档案')
    return
  }
  await quickStage({ kind: 'learn-skill', assetId: asset.id })
}

async function forgetSkill(asset: GameAsset): Promise<void> {
  if (asset.kind !== 'skill' || !snapshot.value?.learnedSkillIds.includes(asset.id)) return
  if (!appStore.selectedChapter?.id) {
    if (!seedDraft.value || selectedCharacterHasEvents.value) { message.warning('请先选择章节'); return }
    const next = toIpcPayload(seedDraft.value)
    next.learnedSkillIds = (next.learnedSkillIds ?? []).filter((id) => id !== asset.id)
    if (await command({ kind: 'set-character', character: next })) message.success('已从人物初始技能中移除')
    return
  }
  await quickStage({ kind: 'forget-skill', assetId: asset.id })
}

async function copyCharacterProfile(): Promise<void> {
  if (!row.value || !snapshot.value || !characterId.value) return
  try {
    await navigator.clipboard.writeText(formatGameCharacterProfile(row.value.data, snapshot.value, characterName(characterId.value)))
    message.success('人物基础数据和技能列表已复制')
  } catch { message.error('复制失败，请重试') }
}

async function setSlotEnabled(slotId: string, enabled: boolean): Promise<void> {
  if (!enabled && equippedAssetFor(slotId)) {
    message.warning('请先卸下此槽位的装备，再关闭槽位')
    return
  }
  if (await command({ kind: 'set-slot-enabled', slotId, enabled })) {
    if (!enabled && activeSlotId.value === slotId) activeSlotId.value = ''
    message.success(enabled ? '装备槽已启用' : '装备槽已关闭')
  }
}

function openSlot(slotId: string): void {
  if (!row.value || !isGameSlotEnabled(row.value.data, slotId)) return
  activeSlotId.value = slotId
  slotQuery.value = ''
}

async function quickStage(operation: GameOperation): Promise<void> {
  if (!appStore.selectedChapter?.id || !characterId.value) {
    message.warning('请先选择章节，再记录换装或加点')
    return
  }
  const success = await command({ kind: 'stage', chapterId: appStore.selectedChapter.id, characterId: characterId.value, operation })
  if (success) {
    if (operation.kind === 'equip' || operation.kind === 'unequip') activeSlotId.value = ''
    message.success('已记录到本章，属性已更新')
  }
}

async function equipFromSlot(asset: GameAsset): Promise<void> {
  if (!snapshot.value?.owned[asset.id]) { message.warning('请先获得这件装备'); return }
  const slotId = asset.slotId === 'ring' || asset.slotId === 'accessory' ? activeSlotId.value : undefined
  if (!appStore.selectedChapter?.id) {
    if (!seedDraft.value || selectedCharacterHasEvents.value) { message.warning('请先选择章节'); return }
    const next = toIpcPayload(seedDraft.value)
    const target = slotId || asset.slotId
    if (target === 'twohand') { delete next.equipped.mainhand; delete next.equipped.offhand }
    if (target === 'mainhand' || target === 'offhand') delete next.equipped.twohand
    next.equipped[target] = asset.id
    if (await command({ kind: 'set-character', character: next })) { activeSlotId.value = ''; message.success('初始装备已保存，属性已更新') }
    return
  }
  await quickStage({ kind: 'equip', assetId: asset.id, ...(slotId ? { slotId } : {}) })
}

async function acquireFromSlot(asset: GameAsset): Promise<void> {
  if (!appStore.selectedChapter?.id) {
    if (!seedDraft.value || selectedCharacterHasEvents.value) { message.warning('请先选择章节'); return }
    const next = toIpcPayload(seedDraft.value)
    next.owned[asset.id] = (next.owned[asset.id] ?? 0) + 1
    if (await command({ kind: 'set-character', character: next })) message.success('已加入初始背包；现在可点击装备')
    return
  }
  await quickStage({ kind: 'acquire', assetId: asset.id, quantity: 1 })
}

async function unequipSlot(slotId: string): Promise<void> {
  const actualSlot = (slotId === 'mainhand' || slotId === 'offhand') && snapshot.value?.equipped.twohand
    ? 'twohand' : slotId
  if (!appStore.selectedChapter?.id) {
    if (!seedDraft.value || selectedCharacterHasEvents.value) { message.warning('请先选择章节'); return }
    const next = toIpcPayload(seedDraft.value)
    delete next.equipped[actualSlot]
    if (await command({ kind: 'set-character', character: next })) { activeSlotId.value = ''; message.success('初始装备已卸下') }
    return
  }
  await quickStage({ kind: 'unequip', slotId: actualSlot })
}

async function saveSeed(): Promise<void> {
  if (seedDraft.value && await command({ kind: 'set-character', character: seedDraft.value })) message.success('初始数值已保存')
}

async function prepare(operation: GameOperation): Promise<void> {
  if (!appStore.selectedChapter?.id || !characterId.value) return
  const result = await window.characterArc.gamePreview({
    projectId: appStore.selectedProjectId, chapterId: appStore.selectedChapter.id, characterId: characterId.value, operation
  })
  if (!result.success || !result.result) { message.error(result.error || '无法预览此次变更'); return }
  pendingOperation.value = operation
  preview.value = result.result
}

async function confirmOperation(): Promise<void> {
  if (!pendingOperation.value || !appStore.selectedChapter?.id) return
  const operation = pendingOperation.value
  if (await command({ kind: 'stage', chapterId: appStore.selectedChapter.id, characterId: characterId.value, operation, narrativeNote: narrativeNote.value })) {
    narrativeNote.value = ''
    message.success('已记录到本章待确认变更')
  }
}

function operationLabel(operation: GameOperation): string {
  switch (operation.kind) {
    case 'level-up': return `升级 ${operation.levels} 级`
    case 'allocate': return `${statName(operation.statId)} +${operation.points} 点`
    case 'acquire': return `获得 ${nameFor(operation.assetId)} ×${operation.quantity}`
    case 'equip': return `装备 ${nameFor(operation.assetId)}${operation.slotId ? `（${slotName(operation.slotId)}）` : ''}`
    case 'unequip': return `卸下 ${slotName(operation.slotId)}`
    case 'activate-title': return `启用称号 ${nameFor(operation.assetId)}`
    case 'deactivate-title': return '停用称号'
    case 'activate-special': return `激活 ${nameFor(operation.assetId)}`
    case 'deactivate-special': return `停用 ${nameFor(operation.assetId)}`
    case 'learn-skill': return `学习技能 ${nameFor(operation.assetId)}`
    case 'forget-skill': return `遗忘技能 ${nameFor(operation.assetId)}`
    case 'use-skill': return `释放技能 ${nameFor(operation.assetId)}`
    case 'take-damage': return `受到 ${operation.amount} 点伤害`
    case 'restore-resource': return `恢复${operation.resourceId === 'health' ? '生命' : '魔法'} ${operation.amount} 点`
    case 'rest': return '休息并恢复全部生命与魔法'
    case 'consume': return `消耗 ${nameFor(operation.assetId)} ×${operation.quantity}`
  }
}

async function addAsset(): Promise<void> {
  if (!assetName.value.trim() || !row.value) { message.warning('请填写名称'); return }
  const asset: GameAsset = {
    id: editingAssetId.value || `manual-${crypto.randomUUID()}`, kind: assetKind.value, name: assetName.value.trim(),
    aliases: assetAliases.value.split(/[,，;；]/).map((value) => value.trim()).filter(Boolean),
    description: assetDescription.value.trim(), rarity: assetRarity.value.trim(),
    tags: assetTags.value.split(/[,，;；]/).map((value) => value.trim()).filter(Boolean),
    slotId: assetKind.value === 'equipment' || assetActivation.value === 'equipped' ? assetSlot.value : '',
    activation: assetKind.value === 'equipment' ? 'equipped' : assetKind.value === 'skill' ? 'learned' : assetActivation.value,
    levelRequirement: assetLevelRequirement.value,
    bonuses: assetKind.value === 'skill' ? {} : Object.fromEntries(Object.entries(assetBonuses.value).filter(([, value]) => Number.isFinite(value) && value !== 0)),
    source: 'manual',
    ...(assetKind.value === 'skill' ? { skill: {
      type: assetSkillType.value, element: assetElement.value.trim() || '无属性',
      manaCost: Math.max(1, Math.round(assetManaCost.value)), cooldownSeconds: Math.max(0, Number(assetCooldown.value) || 0),
      castTimeSeconds: Math.max(0, Number(assetCastTime.value) || 0), range: assetRange.value.trim(),
      effect: assetEffect.value.trim() || assetDescription.value.trim(), target: assetSkillTarget.value,
      outcome: assetSkillOutcome.value, scalingStatId: assetScalingStatId.value,
      powerMultiplier: Math.max(0, Number(assetPowerMultiplier.value) || 0), flatPower: Math.max(0, Number(assetFlatPower.value) || 0),
      durationSeconds: Math.max(0, Number(assetDuration.value) || 0), maxStacks: 1,
      condition: assetCondition.value.trim(), sideEffect: assetSideEffect.value.trim(), prose: assetProse.value.trim()
    } } : {})
  }
  if (await command({ kind: 'upsert-asset', asset })) {
    clearAssetForm()
    selectedAssetId.value = asset.id
    message.success('已加入本作品目录')
  }
}

function clearAssetForm(): void {
  editingAssetId.value = ''
  assetName.value = ''
  assetBonuses.value = {}
  assetLevelRequirement.value = 0
  assetAliases.value = ''
  assetTags.value = ''
  assetRarity.value = ''
  assetDescription.value = ''
  assetSkillType.value = 'spell'
  assetElement.value = '无属性'
  assetManaCost.value = 1
  assetCooldown.value = 0
  assetCastTime.value = 0
  assetRange.value = '近身'
  assetEffect.value = ''
  assetSkillOutcome.value = 'damage'
  assetSkillTarget.value = 'single'
  assetScalingStatId.value = 'spellPower'
  assetPowerMultiplier.value = 1
  assetFlatPower.value = 0
  assetDuration.value = 0
  assetCondition.value = ''
  assetSideEffect.value = ''
  assetProse.value = ''
}

function editSelectedAsset(): void {
  const asset = selectedAsset.value
  if (!asset) return
  editingAssetId.value = asset.id
  assetName.value = asset.name
  assetKind.value = asset.kind
  assetSlot.value = asset.slotId || row.value?.data.slots[0]?.id || ''
  assetActivation.value = asset.activation
  assetBonuses.value = { ...asset.bonuses }
  assetLevelRequirement.value = asset.levelRequirement
  assetAliases.value = asset.aliases.join('，')
  assetTags.value = asset.tags.join('，')
  assetRarity.value = asset.rarity
  assetDescription.value = asset.description
  assetSkillType.value = asset.skill?.type ?? 'spell'
  assetElement.value = asset.skill?.element ?? '无属性'
  assetManaCost.value = asset.skill?.manaCost ?? 1
  assetCooldown.value = asset.skill?.cooldownSeconds ?? 0
  assetCastTime.value = asset.skill?.castTimeSeconds ?? 0
  assetRange.value = asset.skill?.range ?? '近身'
  assetEffect.value = asset.skill?.effect ?? asset.description
  assetSkillOutcome.value = asset.skill?.outcome ?? 'damage'
  assetSkillTarget.value = asset.skill?.target ?? 'single'
  assetScalingStatId.value = asset.skill?.scalingStatId ?? 'spellPower'
  assetPowerMultiplier.value = asset.skill?.powerMultiplier ?? 1
  assetFlatPower.value = asset.skill?.flatPower ?? 0
  assetDuration.value = asset.skill?.durationSeconds ?? 0
  assetCondition.value = asset.skill?.condition ?? ''
  assetSideEffect.value = asset.skill?.sideEffect ?? ''
  assetProse.value = asset.skill?.prose ?? ''
}

function duplicateSelectedAsset(): void {
  if (!selectedAsset.value) return
  editSelectedAsset()
  editingAssetId.value = ''
  assetName.value = `${selectedAsset.value.name}·新版`
  message.info('已复制为新条目草稿；旧条目及历史章节保持不变，修改后点击“加入已确认目录”。')
}

function parseDefinitions(value: string): Array<{ id: string; name: string }> {
  return value.split(/[,，;；\n]/).map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [id, name] = entry.split(/[:：]/).map((part) => part.trim())
    if (!id || !name) throw new Error('请按“ID:名称”填写，例如 attack:攻击。')
    return { id, name }
  })
}

async function saveRules(): Promise<void> {
  if (!row.value) return
  try {
    const parsedStats = parseDefinitions(statDefinitions.value).map((stat) => ({
      category: 'primary' as const, allocatable: true, unit: 'flat' as const,
      ...row.value!.data.stats.find((current) => current.id === stat.id), ...stat
    }))
    const next: GameCommand = rulesEditable.value
      ? { kind: 'configure', pointsPerLevel: pointsPerLevel.value, tierRules: { ...tierRules.value }, stats: parsedStats,
        slots: parseDefinitions(slotDefinitions.value).map((slot) => ({ ...slot,
          enabled: row.value!.data.slots.find((current) => current.id === slot.id)?.enabled })) }
      : { kind: 'configure', pointsPerLevel: pointsPerLevel.value,
        tierRules: { ...tierRules.value },
 }
    if (await command(next)) message.success('规则已保存')
  } catch (error) { message.error(error instanceof Error ? error.message : '规则格式无效') }
}

async function removeCharacterProfile(): Promise<void> {
  if (!characterId.value) return
  const count = row.value?.data.events.filter((event) => event.characterId === characterId.value).length ?? 0
  if (!window.confirm(`永久删除“${characterName(characterId.value)}”的数值档案${count ? `及 ${count} 条章节记录` : ''}？此操作不能撤销。`)) return
  if (await command({ kind: 'remove-character', characterId: characterId.value })) message.success('人物数值档案已永久删除')
}

async function resetSetup(): Promise<void> {
  if (!window.confirm('重置数值初始化？人物数值档案和物品目录会被清空，作品正文不会受影响。')) return
  if (await command({ kind: 'reset-setup' })) message.success('数值初始化已重置')
}

async function cleanupOrphans(): Promise<void> {
  if (!orphanCount.value || !window.confirm(`永久清理 ${orphanCount.value} 条已失效的孤立记录？`)) return
  if (await command({ kind: 'cleanup-orphans' })) message.success('孤立记录已清理')
}

async function commitChapter(): Promise<void> {
  const chapterId = appStore.selectedChapter?.id
  const drafts = chapterEvents.value.filter((event) => event.status === 'draft' && !event.orphaned)
  if (!chapterId || !drafts.length) return
  const summary = drafts.map((event) => `• ${characterName(event.characterId)}：${operationLabel(event.operation)}${event.narrativeNote ? `（${event.narrativeNote}）` : ''}`).join('\n')
  if (!window.confirm(`确认本章全部 ${drafts.length} 条数值变化？\n\n${summary}`)) return
  if (await command({ kind: 'commit-chapter', chapterId })) message.success('本章全部数值变化已确认')
}

async function saveInitialAsset(action: 'add' | 'equip' | 'activate' | 'remove'): Promise<void> {
  const asset = selectedAsset.value
  if (!seedDraft.value || !asset || selectedCharacterHasEvents.value) return
  const next = toIpcPayload(seedDraft.value)
  const targetSlot = (asset.slotId === 'ring' || asset.slotId === 'accessory')
    ? (gameAssetFitsSlot(asset, activeSlotId.value) ? activeSlotId.value : equipTargetSlot.value)
    : asset.slotId
  if (action === 'remove') {
    delete next.owned[asset.id]
    for (const [slotId, equippedId] of Object.entries(next.equipped)) if (equippedId === asset.id) delete next.equipped[slotId]
    if (next.activeTitleId === asset.id) next.activeTitleId = ''
    next.activeSpecialIds = next.activeSpecialIds.filter((id) => id !== asset.id)
  } else {
    next.owned[asset.id] = action === 'add'
      ? (next.owned[asset.id] ?? 0) + Math.max(1, itemQuantity.value)
      : Math.max(next.owned[asset.id] ?? 0, 1)
    if (action === 'equip') {
      if (targetSlot === 'twohand') { delete next.equipped.mainhand; delete next.equipped.offhand }
      if (targetSlot === 'mainhand' || targetSlot === 'offhand') delete next.equipped.twohand
      next.equipped[targetSlot] = asset.id
    }
    if (action === 'activate' && asset.kind === 'title') next.activeTitleId = asset.id
    if (action === 'activate' && asset.kind === 'special' && !next.activeSpecialIds.includes(asset.id)) next.activeSpecialIds.push(asset.id)
  }
  if (await command({ kind: 'set-character', character: next })) message.success('初始背包与装备已保存')
}

async function pickImport(): Promise<void> {
  const result = await window.characterArc.gameImportPreview(appStore.selectedProjectId)
  if (!result.success) message.error(result.error || '读取表格失败')
  else importPreview.value = result.result ?? null
}

async function exportImportTemplate(): Promise<void> {
  const result = await window.characterArc.gameExportTemplate(appStore.selectedProjectId)
  if (!result.success) message.error(result.error || '导出模板失败')
  else if (!result.canceled) message.success('导入模板已保存')
}

async function importAssets(): Promise<void> {
  if (!importPreview.value) return
  const count = importPreview.value.assets.length
  if (await command({ kind: 'import-assets', assets: importPreview.value.assets })) {
    importPreview.value = null
    message.success(`已导入 ${count} 条已确认目录`)
  }
}

async function removeSelectedAsset(): Promise<void> {
  if (!selectedAsset.value || !window.confirm(`删除目录中的“${selectedAsset.value.name}”？已用于人物或章节的条目会被保护。`)) return
  if (await command({ kind: 'remove-asset', assetId: selectedAsset.value.id })) {
    selectedAssetId.value = ''
    clearAssetForm()
    message.success('目录条目已删除')
  }
}

watch(() => appStore.selectedProjectId, () => { activeSlotId.value = ''; void refresh() })
watch(() => appStore.selectedChapter?.id, () => { void refreshSnapshot() })
watch(characterId, () => { activeSlotId.value = ''; void refreshSnapshot() })
watch(assetKind, (value) => {
  if (value === 'equipment') assetActivation.value = 'equipped'
  else if (value === 'skill') assetActivation.value = 'learned'
  else if (assetActivation.value === 'learned') assetActivation.value = 'active'
  else if (value === 'title' && assetActivation.value === 'equipped') assetActivation.value = 'active'
})
watch(selectedAssetId, () => {
  equipTargetSlot.value = selectedAsset.value?.slotId === 'accessory' ? 'accessory1' : 'ring1'
})
onMounted(() => {
  void refresh()
  stopLegacyEvents = window.characterArc.onAiStreamEvent((event) => {
    if (event.type === 'tool_use_start' && event.toolName === 'stage_game_change') legacyGameStreams.add(event.streamId)
    if (event.type === 'tool_result' && event.toolName === 'stage_game_change' && !event.isError) void refresh()
    if ((event.type === 'canceled' || event.type === 'error') && legacyGameStreams.delete(event.streamId)) void refresh()
  })
  stopAssistantEvents = window.characterArc.assistant.onEvent((push: AssistantEventPush) => {
    const event = push.event
    if (event.kind === 'tool_use_start' && event.toolName === 'stage_game_change') {
      assistantGameCalls.add(event.toolUseId)
      assistantGameTurns.add(push.turnId)
    }
    if (event.kind === 'tool_result' && assistantGameCalls.delete(event.toolUseId) && !event.isError) void refresh()
    if ((event.kind === 'canceled' || event.kind === 'error') && assistantGameTurns.delete(push.turnId)) {
      window.setTimeout(() => { void refresh() }, 100)
    }
  })
})
onUnmounted(() => { stopLegacyEvents?.(); stopAssistantEvents?.() })
</script>

<template>
  <div class="game-panel">
    <div class="section-head">
      <strong>游戏数值</strong>
      <span>仅对当前作品生效</span>
    </div>
    <p v-if="!row" class="muted">正在读取本地档案…</p>
    <template v-else>
      <label class="toggle"><input type="checkbox" :checked="row.data.enabled" @change="command({ kind: 'configure', enabled: !row!.data.enabled })" /> 启用游戏数值档案</label>
      <p class="muted">关闭时不影响普通小说。AI 只读取这里确认过的物品与加成，不会生成目录外的装备数值。面板按已保存的派生规则计算；启用战斗判定后，可在下方选择双方试算并暂存伤害。</p>
      <template v-if="row.data.enabled">
        <details><summary>作品数值规则</summary>
          <label>每级属性点 <input v-model.number="pointsPerLevel" type="number" min="0" max="1000" /></label>
          <p class="rule-subtitle">装备与技能成长位阶</p>
          <div class="formula-grid">
            <label>成长位阶从 <input v-model.number="tierRules.growthLevel" type="number" min="2" max="1000" /></label>
            <label>精锐位阶从 <input v-model.number="tierRules.eliteLevel" type="number" min="2" max="1000" /></label>
            <label>大师位阶从 <input v-model.number="tierRules.masterLevel" type="number" min="2" max="1000" /></label>
            <label>传说位阶从 <input v-model.number="tierRules.legendaryLevel" type="number" min="2" max="1000" /></label>
          </div>
          <p class="muted">默认 1–10 入门、11–25 成长、26–50 精锐、51–80 大师、81级以上传说；只影响以后生成的名称与混合品质概率。</p>
          <template v-if="rulesEditable">
            <label>属性定义 <input v-model="statDefinitions" placeholder="attack:攻击，defense:防御" /></label>
            <label>装备槽 <input v-model="slotDefinitions" placeholder="weapon:武器，armor:护甲" /></label>
          </template>
          <p v-else class="muted">已有物品目录或章节记录，属性与槽位已锁定。每级点数的修改只影响以后新记录的升级，不会重算历史。</p>
          <p class="muted">派生公式、属性精度与战斗判定请在下方规则版本中修改。</p>
          <button @click="saveRules">保存规则</button>
          <button v-if="canGenerateTestData" @click="generateTestData">生成测试数据</button>
          <button v-if="!row.data.events.length && (row.data.characters.length || row.data.assets.length)" @click="resetSetup">重置初始化</button>
          <button v-if="orphanCount" @click="cleanupOrphans">清理 {{ orphanCount }} 条孤立记录</button>
        </details>
        <GameRulesEditor :row="row" @saved="refresh" />
        <GameCombatPreview :row="row" @saved="refresh" />
        <div class="section-head"><strong>人物与章节</strong><button @click="refresh">刷新</button></div>
        <div class="character-line"><NSelect v-model:value="characterId" class="character-select" :options="characterOptions" /><button v-if="characterId && row.data.protagonistCharacterId !== characterId" @click="setProtagonist">设为主角</button><span v-else-if="characterId" class="hero-badge">主角</span></div>
        <p class="muted">{{ appStore.selectedChapter?.title || '请先选择章节' }} · 变化先记为本章草稿，确认后成为后续章节的基线。</p>
        <button v-if="characterId && !snapshot" @click="createCharacter">为此人物建立数值档案</button>
        <template v-if="snapshot && seedDraft">
          <template v-if="boardCharacter">
            <div class="section-head"><strong>主角装备栏</strong><span>{{ visibleSlots.filter((slot) => slot.enabled !== false).length }} / {{ visibleSlots.length }} 格启用</span></div>
            <p v-if="!row.data.protagonistCharacterId" class="muted">这是主角装备栏预览。确定主角后点击“设为主角”；其他人物仍可用下方的简洁档案记录数值。</p>
            <div class="equipment-board">
              <NTooltip v-for="slot in visibleSlots" :key="slot.id" placement="top" :show-arrow="false">
                <template #trigger>
                  <button class="equipment-cell" :class="{ occupied: equippedAssetFor(slot.id), disabled: slot.enabled === false, chosen: activeSlotId === slot.id }" :disabled="slot.enabled === false" @click="openSlot(slot.id)">
                    <span class="slot-name">{{ slot.name }}</span>
                    <strong>{{ equippedAssetFor(slot.id)?.name || '＋' }}</strong>
                    <small v-if="equippedAssetFor(slot.id)?.slotId === 'twohand'">双手占用</small>
                    <small v-else-if="slot.enabled === false">未启用</small>
                    <small v-else-if="!equippedAssetFor(slot.id)">点击装备</small>
                  </button>
                </template>
                <div v-if="equippedAssetFor(slot.id)" class="gear-tooltip"><strong>{{ equippedAssetFor(slot.id)!.name }}</strong><p>{{ equippedAssetFor(slot.id)!.rarity || '普通' }} · {{ bonusText(equippedAssetFor(slot.id)!) }}</p><p v-if="equippedAssetFor(slot.id)!.description">{{ equippedAssetFor(slot.id)!.description }}</p></div>
                <span v-else>{{ slot.name }} · 点击查询可装备物品</span>
              </NTooltip>
            </div>
            <div v-if="activeSlot" class="slot-picker">
              <div class="section-head"><strong>{{ activeSlot.name }} · 选择装备</strong><button @click="activeSlotId = ''">关闭</button></div>
              <input v-model="slotQuery" placeholder="搜索该槽位已确认装备" aria-label="搜索槽位装备" />
              <div v-if="equippedAssetFor(activeSlot.id)" class="slot-picker-current"><span>当前：{{ equippedAssetFor(activeSlot.id)!.name }}</span><button @click="unequipSlot(activeSlot.id)">卸下</button></div>
              <div class="slot-candidates"><div v-for="asset in slotCandidates" :key="asset.id" class="slot-candidate"><div><strong>{{ asset.name }}</strong><small>{{ asset.rarity || '普通' }} · {{ bonusText(asset) }} · 等级 {{ asset.levelRequirement || 1 }}</small><small v-if="asset.description">{{ asset.description }}</small></div><button v-if="snapshot.owned[asset.id]" :disabled="snapshot.level < asset.levelRequirement || snapshot.equipped[asset.slotId === 'twohand' ? 'twohand' : activeSlot.id] === asset.id" @click="equipFromSlot(asset)">{{ snapshot.equipped[asset.slotId === 'twohand' ? 'twohand' : activeSlot.id] === asset.id ? '已装备' : snapshot.level < asset.levelRequirement ? '等级不足' : '装备' }}</button><button v-else @click="acquireFromSlot(asset)">先获得</button></div><p v-if="!slotCandidates.length" class="muted">该槽位还没有匹配的已确认装备。可在下方目录管理中新增或导入。</p></div>
            </div>
            <details class="slot-settings"><summary>启用／关闭装备槽</summary><p class="muted">双手武器同时占用主手和副手；已穿戴的装备请先卸下并确认章节变化，再关闭槽位。</p><div class="slot-setting-grid"><label v-for="slot in configurableSlots" :key="slot.id"><input type="checkbox" :checked="slot.enabled !== false" @change="setSlotEnabled(slot.id, !isGameSlotEnabled(row!.data, slot.id))" />{{ slot.name }}</label></div></details>
            <div class="section-head"><strong>主角属性</strong><span>等级 {{ snapshot.level }} · 剩余 {{ snapshot.freePoints }} 点</span></div>
            <div class="resource-grid"><div class="resource-card health"><span>生命值</span><strong>{{ snapshot.currentResources.health }} / {{ snapshot.totals.health ?? 0 }}</strong></div><div class="resource-card mana"><span>魔法值</span><strong>{{ snapshot.currentResources.mana }} / {{ snapshot.totals.mana ?? 0 }}</strong></div></div>
            <div class="hero-level-line"><span>每级获得 {{ row.data.pointsPerLevel }} 点</span><input v-model.number="levelCount" type="number" min="1" title="升级级数" /><button @click="quickStage({ kind: 'level-up', levels: levelCount })">升级</button></div>
            <section v-for="group in statGroups" :key="group.id" class="stat-group"><h4>{{ group.name }}</h4><div class="attribute-panel"><div v-for="stat in group.stats" :key="stat.id" class="attribute-row"><div><strong>{{ stat.name }}</strong><small>基础 {{ snapshot.baseStats[stat.id] ?? 0 }} ＋ 已加 {{ snapshot.allocatedStats[stat.id] ?? 0 }} ＋ 加成 {{ statBonus(stat.id) }}</small></div><strong class="attribute-total">{{ snapshot.totals[stat.id] ?? 0 }}{{ stat.unit === 'percent' ? '%' : '' }}</strong><button v-if="stat.allocatable !== false" :disabled="snapshot.freePoints < points" @click="quickStage({ kind: 'allocate', statId: stat.id, points })">+{{ points }}</button><span v-else class="derived-badge">{{ stat.category === 'special' ? '特殊' : '派生' }}</span></div></div></section>
            <label class="points-input">每次加点 <input v-model.number="points" type="number" min="1" :max="snapshot.freePoints" /></label>
          </template>
          <div v-else class="stat-grid"><div><small>等级</small><strong>{{ snapshot.level }}</strong></div><div><small>剩余点数</small><strong>{{ snapshot.freePoints }}</strong></div><div v-for="stat in row.data.stats" :key="stat.id"><small>{{ stat.name }}</small><strong>{{ snapshot.totals[stat.id] ?? 0 }}</strong></div></div>
          <div class="profile-card">
            <div class="section-head"><strong>人物最终信息</strong><button @click="copyCharacterProfile">一键复制</button></div>
            <div class="profile-overview"><span>等级 {{ snapshot.level }}</span><span>剩余 {{ snapshot.freePoints }} 点</span><span>生命 {{ snapshot.currentResources.health }}/{{ snapshot.totals.health ?? 0 }}</span><span>魔法 {{ snapshot.currentResources.mana }}/{{ snapshot.totals.mana ?? 0 }}</span><span>{{ Object.keys(snapshot.equipped).length }} 件装备</span><span>{{ learnedSkills.length }} 个技能</span></div>
            <div class="battle-controls"><input v-model.number="resourceAmount" type="number" min="1" title="变化数值" /><button @click="quickStage({ kind: 'take-damage', amount: resourceAmount })">受伤</button><button @click="quickStage({ kind: 'restore-resource', resourceId: 'health', amount: resourceAmount })">回血</button><button @click="quickStage({ kind: 'restore-resource', resourceId: 'mana', amount: resourceAmount })">回蓝</button><button @click="quickStage({ kind: 'rest' })">休息全满</button></div>
            <div class="section-head"><strong>已学技能</strong><span>设为已学后，章节 AI 才会把它当作人物能力</span></div>
            <div class="learned-skills"><div v-for="skill in learnedSkills" :key="skill.id" class="skill-card"><div><strong>{{ skill.name }}</strong><small>{{ skillTypeName(skill) }} · {{ skill.skill?.element || '无属性' }} · {{ skillOutcomeOptions.find((item) => item.value === skill.skill?.outcome)?.label || '伤害' }} · 耗蓝 {{ skill.skill?.manaCost ?? 1 }} · 冷却 {{ skill.skill?.cooldownSeconds ?? 0 }}s</small><small>{{ skill.skill?.effect || skill.description || '暂无说明' }}</small><small v-if="skill.skill?.prose" class="skill-prose">小说表现：{{ skill.skill.prose }}</small></div><div class="skill-actions"><button :disabled="!canUseSkill(skill)" @click="quickStage({ kind: 'use-skill', assetId: skill.id })">{{ canUseSkill(skill) ? '释放' : '魔法不足' }}</button><button @click="forgetSkill(skill)">遗忘</button></div></div><p v-if="!learnedSkills.length" class="muted">暂无已学技能。</p></div>
            <details class="skill-picker"><summary>学习／管理技能</summary><input v-model="skillQuery" placeholder="搜索技能名称、标签或说明" /><div class="slot-candidates"><div v-for="skill in skillCandidates" :key="skill.id" class="slot-candidate"><div><strong>{{ skill.name }}</strong><small>{{ skill.rarity || '技能' }} · 学习等级 {{ skill.levelRequirement || 1 }}</small><small>{{ skill.description || '暂无说明' }}</small></div><button v-if="snapshot.learnedSkillIds.includes(skill.id)" @click="forgetSkill(skill)">已学 · 遗忘</button><button v-else :disabled="snapshot.level < skill.levelRequirement" @click="learnSkill(skill)">{{ snapshot.level < skill.levelRequirement ? '等级不足' : '学习' }}</button></div><p v-if="!skillCandidates.length" class="muted">技能目录为空，可在下方“目录管理与导入”新增技能。</p></div></details>
          </div>
          <details><summary>初始数值（作者设定）</summary>
            <p v-if="selectedCharacterHasEvents" class="muted">已有章节数值记录，初始档案已锁定；后续修正请记录为当前章节变化。</p>
            <label>初始等级 <input v-model.number="seedDraft.level" type="number" min="1" :disabled="selectedCharacterHasEvents" /></label>
            <label>初始可用点数 <input v-model.number="seedDraft.freePoints" type="number" min="0" :disabled="selectedCharacterHasEvents" /></label>
            <label v-for="stat in row.data.stats" :key="stat.id">{{ stat.name }} <input v-model.number="seedDraft.baseStats[stat.id]" type="number" :disabled="selectedCharacterHasEvents" /></label>
            <button :disabled="selectedCharacterHasEvents" @click="saveSeed">保存初始数值</button>
            <button class="danger" @click="removeCharacterProfile">永久删除此人物数值档案</button>
          </details>
          <template v-if="!boardCharacter"><div class="section-head"><strong>即时变化</strong></div>
          <div class="inline"><input v-model.number="levelCount" type="number" min="1" title="升级级数" /><button @click="prepare({ kind: 'level-up', levels: levelCount })">升级</button></div>
          <div class="inline"><NSelect v-model:value="statId" :options="statOptions" /><input v-model.number="points" type="number" min="1" title="分配点数" /><button @click="prepare({ kind: 'allocate', statId, points })">加点</button></div></template>
          <details class="catalog-actions"><summary>背包、称号与特殊物品操作</summary>
          <div class="inline"><input v-model="query" placeholder="搜索已确认物品" /><NSelect v-model:value="kind" :options="filterKindOptions" /></div>
          <div class="inline catalog-filters"><NSelect v-model:value="catalogSlot" :options="[{ label: '全部槽位', value: '' }, ...slotOptions]" placeholder="槽位" /><input v-model.number="catalogMinLevel" type="number" min="0" placeholder="最低等级" title="最低等级" /><input v-model.number="catalogMaxLevel" type="number" min="0" placeholder="最高等级" title="最高等级" /></div>
          <p class="muted catalog-count">匹配 {{ matchingAssets.length }} 条 · 第 {{ catalogPage }}/{{ catalogPageCount }} 页</p>
          <div class="asset-list"><button v-for="asset in searchResults" :key="asset.id" :class="{ selected: selectedAssetId === asset.id }" @click="selectedAssetId = asset.id">{{ asset.name }} <small>{{ assetKindName(asset) }}</small></button><span v-if="!searchResults.length" class="muted">目录暂无匹配项目</span></div>
          <div v-if="catalogPageCount > 1" class="catalog-pages"><button :disabled="catalogPage <= 1" @click="catalogPage--">上一页</button><button :disabled="catalogPage >= catalogPageCount" @click="catalogPage++">下一页</button></div>
          <template v-if="selectedAsset">
            <p>{{ selectedAsset.name }} <span class="muted">{{ selectedAsset.rarity }} · {{ selectedAsset.description }}</span></p>
            <p class="muted">{{ Object.entries(selectedAsset.bonuses).map(([id, value]) => `${statName(id)} ${value >= 0 ? '+' : ''}${value}`).join('，') || '无数值加成' }} · 背包 {{ snapshot.owned[selectedAsset.id] ?? 0 }}</p>
            <div v-if="selectedAsset.kind !== 'skill'" class="inline"><input v-model.number="itemQuantity" type="number" min="1" title="物品数量" /><button @click="prepare({ kind: 'acquire', assetId: selectedAsset!.id, quantity: itemQuantity })">获得</button><button @click="prepare({ kind: 'consume', assetId: selectedAsset!.id, quantity: itemQuantity })">消耗</button></div>
            <div v-if="flexibleTargetOptions.length" class="inline"><NSelect v-model:value="equipTargetSlot" :options="flexibleTargetOptions" /></div>
            <div class="inline"><button v-if="selectedAsset.kind === 'equipment' || selectedAsset.activation === 'equipped'" @click="prepare({ kind: 'equip', assetId: selectedAsset!.id, ...(flexibleTargetOptions.length ? { slotId: equipTargetSlot } : {}) })">装备/替换</button><button v-if="selectedAsset.kind === 'title' && selectedAsset.activation === 'active'" @click="prepare({ kind: 'activate-title', assetId: selectedAsset!.id })">启用称号</button><button v-if="selectedAsset.kind === 'special' && selectedAsset.activation === 'active'" @click="prepare({ kind: 'activate-special', assetId: selectedAsset!.id })">激活物品</button><button v-if="selectedAsset.kind === 'skill' && !snapshot.learnedSkillIds.includes(selectedAsset.id)" @click="learnSkill(selectedAsset)">学习技能</button><button v-if="selectedAsset.kind === 'skill' && snapshot.learnedSkillIds.includes(selectedAsset.id)" @click="forgetSkill(selectedAsset)">遗忘技能</button></div>
            <div v-if="!selectedCharacterHasEvents && selectedAsset.kind !== 'skill'" class="initial-loadout"><small>初始档案：</small><button @click="saveInitialAsset('add')">加入初始背包</button><button v-if="selectedAsset.kind === 'equipment' || selectedAsset.activation === 'equipped'" @click="saveInitialAsset('equip')">设为初始装备</button><button v-if="selectedAsset.activation === 'active'" @click="saveInitialAsset('activate')">设为初始启用</button><button v-if="seedDraft?.owned[selectedAsset.id]" @click="saveInitialAsset('remove')">移出初始档案</button></div>
          </template>
          <div v-if="Object.keys(snapshot.equipped).length || snapshot.activeTitleId || snapshot.activeSpecialIds.length" class="current-gear"><div v-for="[slot, assetId] in Object.entries(snapshot.equipped)" :key="slot">{{ slotName(slot) }}：{{ nameFor(assetId) }} <button @click="prepare({ kind: 'unequip', slotId: slot })">卸下</button></div><div v-if="snapshot.activeTitleId">称号：{{ nameFor(snapshot.activeTitleId) }} <button @click="prepare({ kind: 'deactivate-title' })">停用</button></div><div v-for="id in snapshot.activeSpecialIds" :key="id">{{ nameFor(id) }} <button @click="prepare({ kind: 'deactivate-special', assetId: id })">停用</button></div></div>
          </details>
          <details><summary>背包（{{ Object.values(snapshot.owned).filter((count) => count > 0).length }} 种）</summary><div v-for="[id, count] in Object.entries(snapshot.owned).filter(([, amount]) => amount > 0)" :key="id" class="event-row"><span>{{ nameFor(id) }} ×{{ count }}</span><button @click="selectedAssetId = id">查看</button></div></details>
          <div v-if="preview && pendingOperation" class="preview"><strong>确认变化：{{ operationLabel(pendingOperation) }}</strong><div v-for="stat in row.data.stats" :key="stat.id">{{ stat.name }} {{ preview.before.totals[stat.id] }} → {{ preview.after.totals[stat.id] }} <span v-if="preview.delta[stat.id]">({{ preview.delta[stat.id] > 0 ? '+' : '' }}{{ preview.delta[stat.id] }})</span></div><p>等级 {{ preview.before.level }} → {{ preview.after.level }} · 剩余点数 {{ preview.before.freePoints }} → {{ preview.after.freePoints }}</p><input v-model="narrativeNote" maxlength="240" placeholder="变化发生原因，例如：击败岩甲熊后（可选）" /><button :disabled="busy" @click="confirmOperation">记录到本章</button><button @click="pendingOperation = null; preview = null">取消</button></div>
          <div class="section-head"><strong>本章全部人物变化</strong><button v-if="chapterEvents.some((event) => event.status === 'draft' && !event.orphaned)" @click="commitChapter">确认本章全部</button><button v-else-if="chapterEvents.some((event) => event.status === 'committed' && !event.orphaned)" @click="command({ kind: 'reopen-chapter', chapterId: appStore.selectedChapter!.id })">回退本章全部</button></div>
          <div v-for="event in chapterEvents.filter((item) => !item.orphaned)" :key="event.id" class="event-row"><span><b>{{ characterName(event.characterId) }}</b>：{{ operationLabel(event.operation) }}<small v-if="event.narrativeNote"> · {{ event.narrativeNote }}</small> · {{ event.status === 'draft' ? (event.source === 'ai' ? 'AI 待确认' : '待确认') : '已确认' }}</span><button v-if="event.status === 'draft'" @click="command({ kind: 'remove-event', eventId: event.id })">撤销</button></div><p v-if="!chapterEvents.some((event) => !event.orphaned)" class="muted">本章尚无数值变化。</p>
        </template>
        <details><summary>目录管理与导入</summary>
          <p class="muted">可先手动录入，或导入 Excel/CSV；导入前会预览，不会自动生成未知数值。类型支持装备、称号、特殊物品和技能；技能无需槽位，加入人物即视为已学。</p>
          <button @click="appStore.openEquipmentGeneratorPage(appStore.selectedProjectId)">打开高级工具 · 装备与技能库</button>
          <button @click="exportImportTemplate">下载当前规则模板</button><button @click="pickImport">选择 Excel/CSV</button>
          <div v-if="importPreview" class="preview"><strong>{{ importPreview.fileName }} · {{ importPreview.assets.length }} 条</strong><div class="import-preview-list"><p v-for="asset in importPreview.assets" :key="asset.id">{{ asset.name }} · {{ asset.kind }} · {{ asset.slotId || '无槽位' }} · {{ JSON.stringify(asset.bonuses) }}</p></div><button @click="importAssets">确认导入</button><button @click="importPreview = null">取消</button></div>
          <button v-if="selectedAsset" @click="editSelectedAsset">编辑所选条目</button><button v-if="selectedAsset" @click="duplicateSelectedAsset">复制为新条目（保留历史）</button><button v-if="selectedAsset" @click="removeSelectedAsset">删除所选条目</button><button v-if="editingAssetId" @click="clearAssetForm">取消编辑</button>
          <input v-model="assetName" :placeholder="editingAssetId ? '编辑条目名称' : '新条目名称'" /><div class="inline"><NSelect v-model:value="assetKind" :options="assetKindOptions" /><NSelect v-if="assetKind !== 'equipment' && assetKind !== 'skill'" v-model:value="assetActivation" :options="activationOptions" /></div>
          <NSelect v-if="assetKind === 'equipment' || assetActivation === 'equipped'" v-model:value="assetSlot" :options="slotOptions" />
          <label>等级要求 <input v-model.number="assetLevelRequirement" type="number" min="0" /></label>
          <label>别名 <input v-model="assetAliases" placeholder="多个用逗号分隔" /></label>
          <label>标签 <input v-model="assetTags" placeholder="多个用逗号分隔" /></label>
          <label>品质 <input v-model="assetRarity" /></label>
          <label>描述 <input v-model="assetDescription" /></label>
          <template v-if="assetKind === 'skill'">
            <label>技能类型 <NSelect v-model:value="assetSkillType" :options="skillTypeOptions" /></label>
            <label>元素／力量属性 <input v-model="assetElement" /></label>
            <label>魔法消耗 <input v-model.number="assetManaCost" type="number" min="1" /></label>
            <label>冷却秒数 <input v-model.number="assetCooldown" type="number" min="0" step="0.1" /></label>
            <label>施法时间 <input v-model.number="assetCastTime" type="number" min="0" step="0.1" /></label>
            <label>范围 <input v-model="assetRange" placeholder="近身／中距离／远程" /></label>
            <label>效果 <input v-model="assetEffect" placeholder="技能的具体作用" /></label>
            <label>作用类型 <NSelect v-model:value="assetSkillOutcome" :options="skillOutcomeOptions" /></label>
            <label>目标类型 <NSelect v-model:value="assetSkillTarget" :options="skillTargetOptions" /></label>
            <label>加成属性 <NSelect v-model:value="assetScalingStatId" :options="row.data.stats.map((stat) => ({ label: stat.name, value: stat.id }))" /></label>
            <label>基础数值 <input v-model.number="assetFlatPower" type="number" min="0" /></label>
            <label>属性倍率 <input v-model.number="assetPowerMultiplier" type="number" min="0" step="0.05" /></label>
            <label>持续秒数 <input v-model.number="assetDuration" type="number" min="0" step="0.1" /></label>
            <label>使用条件 <input v-model="assetCondition" /></label>
            <label>副作用 <input v-model="assetSideEffect" /></label>
            <label>小说表现 <input v-model="assetProse" placeholder="写入正文时的视觉与动作表现" /></label>
          </template>
          <label v-for="stat in (assetKind === 'skill' ? [] : row.data.stats)" :key="stat.id">{{ stat.name }}加成 <input v-model.number="assetBonuses[stat.id]" type="number" /></label><button @click="addAsset">{{ editingAssetId ? '保存目录条目' : '加入已确认目录' }}</button>
          <p v-if="editingAssetId" class="muted">已用于人物或章节事件的条目不可直接修改，避免历史数值被悄悄重算。</p>
        </details>
      </template>
    </template>
  </div>
</template>

<style scoped>
.game-panel{flex:1;min-height:0;overflow:auto;padding:14px;color:var(--arc-text-primary);font-size:12px;line-height:1.5}
.section-head{display:flex;justify-content:space-between;align-items:center;margin:12px 0 7px}.section-head strong{font-size:13px}.section-head span,.muted,small{color:var(--arc-text-hint)}
.toggle{display:flex;gap:7px;align-items:center}.inline{display:flex;gap:5px;margin:6px 0}.inline>*{min-width:0;flex:1}
input,button{font:inherit;color:inherit;background:var(--arc-bg-surface);border:1px solid var(--arc-border);border-radius:6px;padding:5px 7px}
button{cursor:pointer}button:hover,.asset-list button.selected{border-color:#63a99b}button:disabled{cursor:not-allowed;opacity:.5}.danger{color:#d46b6b}input[type=number]{width:62px}.character-select{max-width:200px}
.stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:10px 0}.stat-grid>div{display:flex;flex-direction:column;padding:7px;background:var(--arc-bg-weak);border:1px solid var(--arc-border);border-radius:6px}
details{border-top:1px solid var(--arc-border);margin-top:12px;padding-top:8px}details label{display:flex;justify-content:space-between;align-items:center;margin:5px 0}details summary{cursor:pointer;font-weight:600;margin-bottom:7px}
.formula-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 9px;margin:8px 0}.formula-grid label{gap:6px}.formula-grid input{width:54px}.rule-subtitle{margin:12px 0 2px;color:var(--arc-text-secondary);font-size:12px;font-weight:700}
.asset-list{max-height:140px;overflow:auto;display:flex;flex-direction:column;gap:4px}.asset-list button{text-align:left;display:flex;justify-content:space-between}.preview{border:1px solid #63a99b;border-radius:8px;padding:9px;margin:9px 0}.preview button{margin-right:5px}.preview p{margin:5px 0}.current-gear,.event-row{margin:7px 0}.current-gear>div,.event-row{display:flex;justify-content:space-between;align-items:center;gap:6px}
.catalog-filters input{max-width:82px}.catalog-count{margin:4px 0}.catalog-pages{display:flex;gap:6px;justify-content:flex-end;margin-top:6px}
.import-preview-list{max-height:180px;overflow:auto;margin:7px 0}
.initial-loadout{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:7px 0}.preview>input{width:100%;box-sizing:border-box;margin:7px 0}
.character-line{display:flex;align-items:center;gap:7px}.character-line .character-select{flex:1;max-width:none}.hero-badge{font-size:11px;color:#4f9f8c;border:1px solid #4f9f8c;border-radius:999px;padding:2px 8px}
.equipment-board{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:8px 0 12px}
.equipment-cell{width:100%;min-width:0;height:82px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;text-align:center;color:var(--arc-text-primary);border-radius:9px;background:var(--arc-bg-surface);border:1px solid var(--arc-border-strong);box-shadow:var(--arc-shadow-sm);padding:5px;transition:border-color .15s,background .15s,box-shadow .15s}
.equipment-cell:hover,.equipment-cell.chosen{border-color:var(--arc-primary);background:var(--arc-primary-soft);box-shadow:var(--arc-shadow-md)}
.equipment-cell.occupied{border-color:color-mix(in srgb,#a98b5b 70%,var(--arc-border));background:color-mix(in srgb,var(--arc-bg-surface) 86%,#a98b5b)}.equipment-cell.disabled{opacity:.48;background:var(--arc-bg-weak);box-shadow:none}.equipment-cell strong{font-size:13px;color:var(--arc-text-primary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.equipment-cell:not(.occupied) strong{font-size:20px;font-weight:400;color:var(--arc-primary)}.slot-name{font-size:11px;color:var(--arc-text-secondary)}.equipment-cell small{font-size:10px;color:var(--arc-text-hint)}
.gear-tooltip{max-width:220px;font-size:12px;line-height:1.45;color:#fff}.gear-tooltip strong{font-size:13px;color:#fff}.gear-tooltip p{margin:4px 0 0;color:rgba(255,255,255,.76);line-height:1.45}
.slot-picker{border:1px solid #63a99b;border-radius:9px;padding:8px;margin:9px 0}.slot-picker>.section-head{margin:0 0 7px}.slot-picker>input{box-sizing:border-box;width:100%}.slot-picker-current{display:flex;align-items:center;justify-content:space-between;gap:6px;margin:7px 0}.slot-candidates{max-height:235px;overflow:auto;margin-top:6px}.slot-candidate{display:flex;justify-content:space-between;align-items:center;gap:7px;padding:7px 0;border-top:1px solid var(--arc-border)}.slot-candidate>div{min-width:0;display:flex;flex-direction:column;gap:2px}.slot-candidate small{font-size:11px}.slot-candidate button{flex:none}
.slot-setting-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:3px 8px}.slot-setting-grid label{display:flex;justify-content:flex-start;gap:4px;white-space:nowrap}.slot-setting-grid input{margin:0}
.hero-level-line{display:flex;align-items:center;gap:7px;margin:7px 0}.hero-level-line span{flex:1;color:var(--arc-text-hint)}.hero-level-line input{width:44px}
.resource-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:7px 0}.resource-card{display:flex;align-items:center;justify-content:space-between;padding:9px;border:1px solid var(--arc-border);border-radius:8px;background:var(--arc-bg-surface)}.resource-card.health strong{color:#c25e63}.resource-card.mana strong{color:#4b83bd}.resource-card span{color:var(--arc-text-secondary)}
.attribute-panel{border:1px solid var(--arc-border);border-radius:9px;overflow:hidden;background:var(--arc-bg-surface)}.attribute-row{display:flex;align-items:center;gap:7px;padding:8px;border-top:1px solid var(--arc-border)}.attribute-row:first-child{border-top:0}.attribute-row>div{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.attribute-row small{font-size:11px}.attribute-total{font-size:15px;color:var(--arc-primary)}.attribute-row button{min-width:38px}.derived-badge{min-width:38px;text-align:center;font-size:10px;color:var(--arc-text-hint)}.points-input{display:flex;align-items:center;justify-content:flex-end;gap:6px;margin-top:7px;color:var(--arc-text-hint)}.points-input input{width:48px}
.stat-group{margin:9px 0}.stat-group h4{margin:0 0 5px;color:var(--arc-text-secondary);font-size:11px;font-weight:700}.skill-prose{color:var(--arc-text-hint)!important;font-style:italic}
.profile-card{margin:12px 0;padding:10px;border:1px solid color-mix(in srgb,var(--arc-primary) 35%,var(--arc-border));border-radius:10px;background:var(--arc-bg-weak);box-shadow:var(--arc-shadow-sm)}.profile-card>.section-head:first-child{margin-top:0}.profile-card>.section-head strong{font-size:14px}.profile-overview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin:8px 0}.profile-overview span{padding:7px;color:var(--arc-text-secondary);border:1px solid var(--arc-border);border-radius:7px;background:var(--arc-bg-surface);text-align:center}.learned-skills{display:flex;flex-direction:column;gap:6px}.skill-card{display:flex;justify-content:space-between;align-items:center;gap:7px;padding:8px;color:var(--arc-text-primary);background:var(--arc-bg-surface);border:1px solid var(--arc-border);border-radius:7px;box-shadow:var(--arc-shadow-sm)}.skill-card>div{min-width:0;display:flex;flex-direction:column;gap:2px}.skill-card strong{font-size:13px;color:var(--arc-text-primary)}.skill-card small{font-size:11px;color:var(--arc-text-secondary);line-height:1.45}.skill-card button{flex:none}.skill-picker>input{width:100%;box-sizing:border-box}
.battle-controls{display:flex;flex-wrap:wrap;gap:5px;margin:8px 0}.battle-controls input{width:55px}.battle-controls button{flex:1;min-width:62px}.skill-card .skill-actions{flex:none;flex-direction:row}.skill-actions button{white-space:nowrap}
</style>
