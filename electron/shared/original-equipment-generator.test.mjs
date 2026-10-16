import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateOriginalEquipmentCount, generateOriginalEquipment } from './original-equipment-generator.ts'

const request = {
  stats: [
    { id: 'health', name: '生命值', category: 'resource' },
    { id: 'mana', name: '魔法值', category: 'resource' },
    { id: 'attack', name: '攻击', category: 'combat' },
    { id: 'defense', name: '防御', category: 'combat' },
    { id: 'strength', name: '力量', category: 'primary' },
    { id: 'agility', name: '敏捷', category: 'primary' },
    { id: 'luck', name: '幸运', category: 'special' }
  ],
  slots: [
    { id: 'head', name: '头' },
    { id: 'chest', name: '胸' },
    { id: 'ring', name: '戒指（任一戒指位）' },
    { id: 'twohand', name: '双手武器' }
  ],
  slotIds: ['head', 'chest', 'ring', 'twohand'],
  levelMin: 10,
  levelMax: 20,
  mode: 'supplement',
  levelStep: 5,
  itemsPerSlot: 1,
  count: 12,
  rarity: '混合',
  style: '东方玄幻',
  intensity: 'standard',
  seed: 'stable-preview',
  existingNames: ['赤霄战冠']
}

test('相同条件与种子生成稳定的原创装备预览', () => {
  const first = generateOriginalEquipment(request)
  const second = generateOriginalEquipment(request)
  assert.deepEqual(first, second)
  assert.equal(first.length, 12)
  assert.equal(new Set(first.map((asset) => asset.id)).size, 12)
  assert.equal(new Set(first.map((asset) => asset.name)).size, 12)
})

test('生成结果只使用作品已有属性与选定槽位，并可直接加入装备目录', () => {
  const assets = generateOriginalEquipment(request)
  const statIds = new Set(request.stats.map((stat) => stat.id))
  for (const asset of assets) {
    assert.equal(asset.kind, 'equipment')
    assert.equal(asset.activation, 'equipped')
    assert.equal(asset.source, 'manual')
    assert.ok(request.slotIds.includes(asset.slotId))
    assert.ok(asset.levelRequirement >= 10 && asset.levelRequirement <= 20)
    assert.ok(Object.keys(asset.bonuses).length >= 1)
    assert.ok(Object.keys(asset.bonuses).every((id) => statIds.has(id)))
    assert.ok(Object.values(asset.bonuses).every((value) => Number.isSafeInteger(value) && value > 0))
    assert.ok(asset.tags.includes('原创生成'))
    assert.notEqual(asset.name, '赤霄战冠')
  }
})

test('双手武器的同级属性预算高于戒指', () => {
  const shared = { ...request, count: 1, levelMin: 30, levelMax: 30, rarity: '稀有', seed: 'budget' }
  const ring = generateOriginalEquipment({ ...shared, slotIds: ['ring'] })[0]
  const twohand = generateOriginalEquipment({ ...shared, slotIds: ['twohand'] })[0]
  const total = (asset) => Object.values(asset.bonuses).reduce((sum, value) => sum + value, 0)
  assert.ok(total(twohand) > total(ring))
})

test('武器不增加生命，幸运只出现在稀有以上饰品', () => {
  const shared = { ...request, count: 30, levelMin: 30, levelMax: 30, rarity: '传说', seed: 'affinity' }
  const weapons = generateOriginalEquipment({ ...shared, slotIds: ['twohand'] })
  assert.ok(weapons.every((asset) => asset.bonuses.health === undefined && asset.bonuses.luck === undefined))
  const normalAccessories = generateOriginalEquipment({ ...shared, rarity: '普通', slotIds: ['ring'] })
  assert.ok(normalAccessories.every((asset) => asset.bonuses.luck === undefined))
})

test('按每五级一阶段，为每个选定槽位生成完整成长装备', () => {
  const staged = {
    ...request,
    mode: 'stages',
    levelMin: 1,
    levelMax: 20,
    levelStep: 5,
    itemsPerSlot: 1,
    slotIds: ['head', 'chest']
  }
  assert.equal(calculateOriginalEquipmentCount(staged), 8)
  const assets = generateOriginalEquipment(staged)
  assert.deepEqual([...new Set(assets.map((asset) => asset.levelRequirement))], [1, 6, 11, 16])
  for (const level of [1, 6, 11, 16]) {
    assert.deepEqual(assets.filter((asset) => asset.levelRequirement === level).map((asset) => asset.slotId), ['head', 'chest'])
  }
  assert.ok(assets.filter((asset) => asset.levelRequirement <= 10).every((asset) => asset.tags.includes('入门位阶')))
  assert.ok(assets.filter((asset) => asset.levelRequirement >= 11).every((asset) => asset.tags.includes('成长位阶')))
})

test('低级与高级装备使用不同词汇层级，批量重名不追加数字', () => {
  const starter = generateOriginalEquipment({ ...request, count: 40, levelMin: 1, levelMax: 1, rarity: '普通', seed: 'starter-equipment' })
  const legendary = generateOriginalEquipment({ ...request, count: 40, levelMin: 90, levelMax: 90, rarity: '传说', seed: 'legendary-equipment' })
  assert.ok(starter.every((asset) => asset.tags.includes('入门位阶')))
  assert.ok(legendary.every((asset) => asset.tags.includes('传说位阶')))
  assert.ok(starter.every((asset) => !/(烛照|九曜|万象|吞星|开天|镇海)/.test(asset.name)))
  assert.ok(legendary.some((asset) => /(烛照|九曜|万象|吞星|开天|镇海|山海|天门)/.test(asset.name)))
  assert.ok([...starter, ...legendary].every((asset) => !/·\d+$/.test(asset.name)))
})

test('装备生成器沿用作品自定义的位阶分界', () => {
  const [asset] = generateOriginalEquipment({
    ...request, count: 1, levelMin: 20, levelMax: 20,
    tierRules: { growthLevel: 5, eliteLevel: 10, masterLevel: 15, legendaryLevel: 20 }
  })
  assert.ok(asset.tags.includes('传说位阶'))
})

test('整套模式把通用戒指与饰品展开为人物栏里的两个实体位置', () => {
  const staged = {
    ...request,
    slots: [
      ...request.slots,
      { id: 'ring1', name: '戒指一' },
      { id: 'ring2', name: '戒指二' },
      { id: 'accessory', name: '饰品（任一饰品位）' },
      { id: 'accessory1', name: '饰品一' },
      { id: 'accessory2', name: '饰品二' }
    ],
    mode: 'stages',
    levelMin: 1,
    levelMax: 5,
    levelStep: 5,
    itemsPerSlot: 1,
    slotIds: ['ring', 'accessory']
  }
  assert.equal(calculateOriginalEquipmentCount(staged), 4)
  assert.deepEqual(generateOriginalEquipment(staged).map((asset) => asset.slotId), ['ring', 'ring', 'accessory', 'accessory'])
})

test('无属性、无槽位和越界数量会明确拒绝', () => {
  assert.throws(() => generateOriginalEquipment({ ...request, stats: [] }), /至少定义一个人物属性/)
  assert.throws(() => generateOriginalEquipment({ ...request, slotIds: [] }), /至少选择一个装备槽位/)
  assert.throws(() => generateOriginalEquipment({ ...request, count: 301 }), /1–300/)
  assert.throws(() => generateOriginalEquipment({ ...request, mode: 'stages', levelMin: 1, levelMax: 100, levelStep: 1, itemsPerSlot: 1 }), /最多生成 300/)
})
