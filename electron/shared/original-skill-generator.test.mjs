import assert from 'node:assert/strict'
import test from 'node:test'
import { calculateOriginalSkillCount, generateOriginalSkills } from './original-skill-generator.ts'

const request = {
  levelMin: 1, levelMax: 20, levelStep: 5, skillsPerStage: 2,
  style: '东方玄幻', rarity: '混合', types: ['spell', 'combat'], elements: ['火', '风'],
  stats: [
    { id: 'strength', name: '力量' }, { id: 'intelligence', name: '智力' },
    { id: 'health', name: '生命上限' }, { id: 'attack', name: '攻击' }, { id: 'spellPower', name: '法术强度' }
  ],
  seed: 'stable-skills', existingNames: []
}

test('每五级生成一阶技能，法术和战技都消耗魔法', () => {
  assert.equal(calculateOriginalSkillCount(request), 8)
  const skills = generateOriginalSkills(request)
  assert.equal(skills.length, 8)
  assert.deepEqual([...new Set(skills.map((asset) => asset.levelRequirement))], [1, 6, 11, 16])
  assert.deepEqual(new Set(skills.map((asset) => asset.skill.type)), new Set(['spell', 'combat']))
  assert.ok(skills.every((asset) => asset.kind === 'skill' && asset.activation === 'learned'))
  assert.ok(skills.every((asset) => Number.isSafeInteger(asset.skill.manaCost) && asset.skill.manaCost >= 1))
  assert.ok(skills.every((asset) => asset.skill.effect.includes('×') || asset.skill.outcome === 'movement' || asset.skill.outcome === 'control' || asset.skill.outcome === 'buff' || asset.skill.outcome === 'debuff' || asset.skill.outcome === 'summon'))
  assert.ok(skills.every((asset) => asset.skill.prose.length >= 15))
  assert.ok(skills.every((asset) => request.stats.some((stat) => stat.id === asset.skill.scalingStatId)))
  assert.ok(skills.every((asset) => !asset.skill.effect.includes('完成一次攻防动作')))
  assert.ok(skills.filter((asset) => asset.levelRequirement <= 10).every((asset) => asset.tags.includes('入门位阶')))
  assert.ok(skills.filter((asset) => asset.levelRequirement >= 11).every((asset) => asset.tags.includes('成长位阶')))
})

test('自定义属性体系不会生成不存在的技能加成属性', () => {
  const skills = generateOriginalSkills({ ...request, stats: [{ id: 'might', name: '威能' }] })
  assert.ok(skills.every((asset) => asset.skill.scalingStatId === 'might'))
  assert.ok(skills.every((asset) => !asset.skill.effect.includes('法术强度') && !asset.skill.effect.includes('攻击×')))
})

test('同一种子的技能预览稳定且不重名', () => {
  const first = generateOriginalSkills(request)
  assert.deepEqual(first, generateOriginalSkills(request))
  assert.equal(new Set(first.map((asset) => asset.name)).size, first.length)
})

test('超过单次数量上限或缺少类型会拒绝', () => {
  assert.throws(() => generateOriginalSkills({ ...request, types: [] }), /至少选择一种技能类型/)
  assert.throws(() => generateOriginalSkills({ ...request, levelMax: 1000, levelStep: 1, skillsPerStage: 1 }), /最多生成 300/)
})

test('大批量技能使用独立名称而不是同名技能的数字序号', () => {
  const skills = generateOriginalSkills({
    ...request, levelMin: 1, levelMax: 100, levelStep: 1, skillsPerStage: 3,
    types: ['spell'], elements: ['火'], rarity: '普通', seed: 'three-hundred-unique-skills'
  })
  assert.equal(skills.length, 300)
  assert.equal(new Set(skills.map((asset) => asset.name)).size, skills.length)
  assert.ok(skills.every((asset) => !/·\d+$/.test(asset.name)), '技能名不应使用 ·2、·3 形式区分重复项')
  assert.ok(skills.every((asset) => !('rank' in asset.skill) && !('maxRank' in asset.skill)), '每个技能应独立存在，不再设置同技能等级')
})

test('低级技能不会提前使用传说级词汇', () => {
  const starter = generateOriginalSkills({ ...request, levelMin: 1, levelMax: 1, levelStep: 1, skillsPerStage: 20, rarity: '普通', seed: 'starter-skill-names' })
  const legendary = generateOriginalSkills({ ...request, levelMin: 90, levelMax: 90, levelStep: 1, skillsPerStage: 20, rarity: '传说', seed: 'legendary-skill-names' })
  assert.ok(starter.every((asset) => asset.tags.includes('入门位阶')))
  assert.ok(starter.every((asset) => !/(吞星|开天|斩神式|破灭指|九曜|烛照|万象|山海)/.test(asset.name)))
  assert.ok(legendary.every((asset) => asset.tags.includes('传说位阶')))
})

test('技能生成器沿用作品自定义的位阶分界', () => {
  const [asset] = generateOriginalSkills({
    ...request, levelMin: 20, levelMax: 20, levelStep: 1, skillsPerStage: 1,
    tierRules: { growthLevel: 5, eliteLevel: 10, masterLevel: 15, legendaryLevel: 20 }
  })
  assert.ok(asset.tags.includes('传说位阶'))
})
