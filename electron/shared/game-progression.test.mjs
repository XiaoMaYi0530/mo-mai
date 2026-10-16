import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyGameProject,
  formatGameCharacterProfile,
  gameSnapshot,
  previewGameOperation,
  searchGameAssets
} from './game-progression.ts'

function fixture() {
  const data = emptyGameProject()
  data.enabled = true
  data.stats = [{ id: 'attack', name: '攻击' }, { id: 'strength', name: '力量' }]
  data.characters = [{
    characterId: 'hero', level: 12, experience: 0, freePoints: 2,
    baseStats: { attack: 50, strength: 20 }, allocatedStats: {},
    owned: { old: 1, new: 1, title: 1, charm: 1 }, equipped: { mainhand: 'old' },
    activeTitleId: 'title', activeSpecialIds: [], learnedSkillIds: [], currentResources: {}
  }]
  data.assets = [
    { id: 'old', kind: 'equipment', name: '旧剑', aliases: [], description: '', rarity: '', tags: [], slotId: 'mainhand', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 6 }, source: 'manual' },
    { id: 'new', kind: 'equipment', name: '赤纹剑', aliases: ['红剑'], description: '', rarity: '', tags: ['火系'], slotId: 'mainhand', activation: 'equipped', levelRequirement: 10, bonuses: { attack: 10 }, source: 'import' },
    { id: 'title', kind: 'title', name: '山海猎手', aliases: [], description: '', rarity: '', tags: [], slotId: '', activation: 'active', levelRequirement: 1, bonuses: { attack: 3 }, source: 'manual' },
    { id: 'charm', kind: 'special', name: '赤玉护符', aliases: [], description: '', rarity: '', tags: [], slotId: '', activation: 'owned', levelRequirement: 1, bonuses: { attack: 2 }, source: 'manual' }
  ]
  return data
}

test('大目录可请求超过默认 40 条的搜索结果供分页使用', () => {
  const data = emptyGameProject()
  data.assets = Array.from({ length: 121 }, (_, index) => ({
    id: `item-${index}`, kind: 'equipment', name: `测试装备 ${index}`,
    aliases: [], description: '', rarity: '', tags: [], slotId: 'head',
    activation: 'equipped', levelRequirement: index + 1, bonuses: {}, source: 'manual'
  }))
  assert.equal(searchGameAssets(data, '测试装备').length, 40)
  assert.equal(searchGameAssets(data, '测试装备', undefined, data.assets.length).length, 121)
})

test('装备、称号、背包持有加成只按明确生效条件计算，换装立即给出差值', () => {
  const data = fixture()
  const before = gameSnapshot(data, 'hero', 1, 'ch1')
  assert.equal(before.totals.attack, 61)
  const preview = previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'new' })
  assert.equal(preview.before.totals.attack, 61)
  assert.equal(preview.after.totals.attack, 65)
  assert.equal(preview.delta.attack, 4)
  assert.deepEqual(preview.after.equipped, { mainhand: 'new' })
})

test('四项主属性派生生命魔法与战斗属性，非主属性不能直接加点', () => {
  const data = emptyGameProject()
  data.enabled = true
  data.characters = [{
    characterId: 'hero', level: 10, experience: 0, freePoints: 3,
    baseStats: { health: 100, mana: 50, strength: 5, agility: 10, intelligence: 5, constitution: 3 },
    allocatedStats: {}, owned: {}, equipped: {}, activeTitleId: '', activeSpecialIds: [], learnedSkillIds: [], currentResources: {}
  }]
  const snapshot = gameSnapshot(data, 'hero', 0)
  assert.equal(snapshot.totals.health, 130)
  assert.equal(snapshot.totals.mana, 90)
  assert.equal(snapshot.totals.attack, 10)
  assert.equal(snapshot.totals.spellPower, 10)
  assert.equal(snapshot.totals.speed, 10)
  assert.equal(snapshot.totals.dodge, 2)
  assert.equal(snapshot.totals.critical, 1)
  assert.throws(() => previewGameOperation(data, 'hero', 0, '', { kind: 'allocate', statId: 'health', points: 1 }), /不允许直接加点/)
})

test('作品可自定义属性派生公式', () => {
  const data = emptyGameProject()
  data.derivedRules.healthPerConstitution = 20
  data.derivedRules.manaPerIntelligence = 12
  data.characters = [{
    characterId: 'hero', level: 1, experience: 0, freePoints: 0,
    baseStats: { health: 100, mana: 50, constitution: 3, intelligence: 5 }, allocatedStats: {}, owned: {}, equipped: {},
    activeTitleId: '', activeSpecialIds: [], learnedSkillIds: [], currentResources: {}
  }]
  const snapshot = gameSnapshot(data, 'hero', 0)
  assert.equal(snapshot.totals.health, 160)
  assert.equal(snapshot.totals.mana, 110)
})

test('所有已学技能均消耗魔法，休息可恢复生命和魔法', () => {
  const data = emptyGameProject()
  data.enabled = true
  data.characters = [{
    characterId: 'hero', level: 10, experience: 0, freePoints: 0,
    baseStats: { health: 100, mana: 50 }, allocatedStats: {}, owned: {}, equipped: {}, activeTitleId: '',
    activeSpecialIds: [], learnedSkillIds: ['slash'], currentResources: {}
  }]
  data.assets = [{
    id: 'slash', kind: 'skill', name: '破锋斩', aliases: [], description: '', rarity: '普通', tags: ['战技'], slotId: '',
    activation: 'learned', levelRequirement: 1, bonuses: {}, source: 'manual',
    skill: { type: 'combat', element: '无属性', manaCost: 12, cooldownSeconds: 3, castTimeSeconds: 0, range: '近身', effect: '料敌先机斩击' }
  }]
  const used = previewGameOperation(data, 'hero', 0, '', { kind: 'use-skill', assetId: 'slash' })
  assert.equal(used.after.currentResources.mana, 38)
  data.characters[0].currentResources = { health: 25, mana: 3 }
  const rested = previewGameOperation(data, 'hero', 0, '', { kind: 'rest' })
  assert.deepEqual(rested.after.currentResources, { health: 100, mana: 50 })
  assert.throws(() => previewGameOperation(data, 'hero', 0, '', { kind: 'use-skill', assetId: 'slash' }), /魔法值不足/)
})

test('未获装备、未知装备和属性点超支不能生效', () => {
  const data = fixture()
  assert.throws(() => previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'invented' }), /不在已确认目录/)
  data.characters[0].owned.new = 0
  assert.throws(() => previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'new' }), /尚未获得/)
  assert.throws(() => previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'allocate', statId: 'strength', points: 3 }), /属性点不足/)
})

test('本章暂存事件供当前写作读取，不泄漏到未来或过去章节；确认后可回放', () => {
  const data = fixture()
  data.events.push({ id: 'e1', characterId: 'hero', chapterId: 'ch2', chapterIndex: 2, order: 1, status: 'draft', operation: { kind: 'equip', assetId: 'new' }, source: 'manual', createdAt: '' })
  assert.equal(gameSnapshot(data, 'hero', 2, 'ch2').totals.attack, 65)
  assert.equal(gameSnapshot(data, 'hero', 2).totals.attack, 61)
  assert.equal(gameSnapshot(data, 'hero', 3).totals.attack, 61)
  data.events[0].status = 'committed'
  assert.equal(gameSnapshot(data, 'hero', 1).totals.attack, 61)
  assert.equal(gameSnapshot(data, 'hero', 3).totals.attack, 65)
})

test('目录搜索支持别名、标签和装备类别，不生成目录外结果', () => {
  const data = fixture()
  assert.deepEqual(searchGameAssets(data, '红剑').map((asset) => asset.id), ['new'])
  assert.deepEqual(searchGameAssets(data, '火系', 'equipment').map((asset) => asset.id), ['new'])
  assert.deepEqual(searchGameAssets(data, '天外神兵'), [])
})

test('预览不会改动原快照，装备型特殊物品只在装备后生效', () => {
  const data = fixture()
  data.assets.push({ id: 'orb', kind: 'special', name: '灵珠', aliases: [], description: '', rarity: '', tags: [], slotId: 'accessory1', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 5 }, source: 'manual' })
  data.characters[0].owned.orb = 1
  const preview = previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'orb' })
  assert.equal(preview.before.equipped.accessory1, undefined)
  assert.equal(preview.before.totals.attack, 61)
  assert.equal(preview.after.totals.attack, 66)
  assert.equal(gameSnapshot(data, 'hero', 1, 'ch1').totals.attack, 61)
})

test('默认呈现十六个独立装备格，双手武器占用主手和副手', () => {
  const data = fixture()
  assert.equal(data.slots.filter((slot) => !['twohand', 'ring', 'accessory'].includes(slot.id)).length, 16)
  data.assets.push({ id: 'shield', kind: 'equipment', name: '木盾', aliases: [], description: '', rarity: '', tags: [], slotId: 'offhand', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 2 }, source: 'manual' })
  data.assets.push({ id: 'greatsword', kind: 'equipment', name: '双手剑', aliases: [], description: '', rarity: '', tags: [], slotId: 'twohand', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 20 }, source: 'manual' })
  data.characters[0].owned.shield = 1
  data.characters[0].owned.greatsword = 1
  data.events.push({ id: 'e1', characterId: 'hero', chapterId: 'ch1', chapterIndex: 1, order: 1, status: 'draft', operation: { kind: 'equip', assetId: 'shield' }, source: 'manual', createdAt: '' })
  const preview = previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'greatsword' })
  assert.deepEqual(preview.before.equipped, { mainhand: 'old', offhand: 'shield' })
  assert.deepEqual(preview.after.equipped, { twohand: 'greatsword' })
  assert.equal(preview.after.totals.attack, 75)
  data.events.push({ id: 'e2', characterId: 'hero', chapterId: 'ch1', chapterIndex: 1, order: 2, status: 'draft', operation: { kind: 'equip', assetId: 'greatsword' }, source: 'manual', createdAt: '' })
  assert.deepEqual(previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'old' }).after.equipped, { mainhand: 'old' })
})

test('同一戒指可在两个戒指格装备，但必须拥有两件且加成计两次', () => {
  const data = fixture()
  data.assets.push({ id: 'ring', kind: 'equipment', name: '力量戒指', aliases: [], description: '', rarity: '', tags: [], slotId: 'ring', activation: 'equipped', levelRequirement: 1, bonuses: { strength: 3 }, source: 'manual' })
  data.characters[0].owned.ring = 1
  data.events.push({ id: 'e1', characterId: 'hero', chapterId: 'ch1', chapterIndex: 1, order: 1, status: 'draft', operation: { kind: 'equip', assetId: 'ring', slotId: 'ring1' }, source: 'manual', createdAt: '' })
  assert.throws(() => previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'ring', slotId: 'ring2' }), /数量/)
  data.characters[0].owned.ring = 2
  const preview = previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'equip', assetId: 'ring', slotId: 'ring2' })
  assert.equal(preview.after.totals.strength, 26)
  assert.deepEqual(preview.after.equipped, { mainhand: 'old', ring1: 'ring', ring2: 'ring' })
})

test('关闭的装备格不可新增穿戴，但旧章节已经记录的装备仍可回放', () => {
  const data = fixture()
  data.events.push({ id: 'e1', characterId: 'hero', chapterId: 'ch1', chapterIndex: 1, order: 1, status: 'committed', operation: { kind: 'unequip', slotId: 'mainhand' }, source: 'manual', createdAt: '' })
  data.slots.find((slot) => slot.id === 'mainhand').enabled = false
  assert.equal(gameSnapshot(data, 'hero', 1).totals.attack, 55)
  assert.throws(() => previewGameOperation(data, 'hero', 1, 'ch2', { kind: 'equip', assetId: 'new' }), /已在本作品关闭/)
})

test('人物可学习多个已确认技能，最终信息可复制基础数据和技能说明', () => {
  const data = fixture()
  data.assets.push(
    { id: 'fireball', kind: 'skill', name: '火球术', aliases: [], description: '发射火球攻击目标。', rarity: '基础', tags: ['法术'], slotId: '', activation: 'learned', levelRequirement: 1, bonuses: {}, source: 'manual' },
    { id: 'dash', kind: 'skill', name: '疾风步', aliases: [], description: '短距离快速移动。', rarity: '进阶', tags: ['身法'], slotId: '', activation: 'learned', levelRequirement: 5, bonuses: {}, source: 'manual' }
  )
  data.events.push(
    { id: 's1', characterId: 'hero', chapterId: 'ch1', chapterIndex: 1, order: 1, status: 'draft', operation: { kind: 'learn-skill', assetId: 'fireball' }, source: 'manual', createdAt: '' },
    { id: 's2', characterId: 'hero', chapterId: 'ch1', chapterIndex: 1, order: 2, status: 'draft', operation: { kind: 'learn-skill', assetId: 'dash' }, source: 'manual', createdAt: '' }
  )
  const snapshot = gameSnapshot(data, 'hero', 1, 'ch1')
  assert.deepEqual(snapshot.learnedSkillIds, ['fireball', 'dash'])
  const profile = formatGameCharacterProfile(data, snapshot, '陆烬')
  assert.match(profile, /人物：陆烬/)
  assert.match(profile, /攻击：61（基础 50，加点 0，加成 \+11）/)
  assert.match(profile, /火球术（消耗魔法 1）：发射火球攻击目标/)
  assert.match(profile, /疾风步（消耗魔法 1）：短距离快速移动/)
  assert.throws(() => previewGameOperation(data, 'hero', 1, 'ch1', { kind: 'acquire', assetId: 'fireball', quantity: 1 }), /学习技能/)
})
