import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveSkillPreset, SKILL_PRESETS } from './skill-presets.ts'

const skills = [
  { id: '我吃西红柿架构', name: '仙侠升级流架构', genreIds: ['xianxia', 'xuanhuan'] },
  { id: '我吃西红柿笔锋', name: '人物驱动自然文风', genreIds: ['general'] },
  { id: 'novel-pacing', name: '章节节奏与结构', genreIds: ['general'] },
  { id: 'novel-pleasure-points', name: '爽点设计' },
  { id: 'novel-worldbuilding', name: '世界观与设定' },
  { id: 'novel-character-design', name: '人物与群像设计' },
  { id: 'novel-compliance', name: '内容合规检查' }
]

test('网游正文预设加入数值战斗 Skill，其他题材不加入', () => {
  const available = [...skills, { id: 'game-combat-writing', name: '网游数值战斗写作', genreIds: ['game'] }]
  const game = resolveSkillPreset('draft', available, '网游升级')
  assert.ok(game.policy.skillIds.includes('game-combat-writing'))
  assert.deepEqual(game.missingRoles, [])
  const romance = resolveSkillPreset('draft', available, '都市言情')
  assert.ok(!romance.policy.skillIds.includes('game-combat-writing'))
  assert.deepEqual(romance.missingRoles, [])
})

test('五套创作预设名称清晰且 ID 唯一', () => {
  assert.deepEqual(SKILL_PRESETS.map((item) => item.name), ['正文创作', '正文润色', '大纲设计', '设定建设', '审计检查'])
  assert.equal(new Set(SKILL_PRESETS.map((item) => item.id)).size, SKILL_PRESETS.length)
})

test('正文创作预设解析当前全局中文 Skill', () => {
  const result = resolveSkillPreset('draft', skills, '仙侠修真')
  assert.deepEqual(result.policy, { mode: 'only', skillIds: ['我吃西红柿架构', '我吃西红柿笔锋'], presetId: 'draft' })
  assert.deepEqual(result.missingRoles, [])
  assert.equal(result.customized, false)
})

test('预设兼容历史英文目录 ID，并报告缺少的角色', () => {
  const result = resolveSkillPreset('outline', [
    { id: 'chinese-xianxia-serial-writer', name: '旧版架构' },
    { id: 'novel-pacing', name: '章节节奏与结构' }
  ])
  assert.deepEqual(result.policy.skillIds, ['chinese-xianxia-serial-writer', 'novel-pacing'])
  assert.deepEqual(result.missingRoles, ['爽点设计'])
})

test('未安装自定义 Skill 时使用内置节奏和文风作为正文预设兜底', () => {
  const result = resolveSkillPreset('draft', [
    { id: 'novel-pacing', name: '章节节奏与结构' },
    { id: 'novel-language-style', name: '语言与文风' }
  ])
  assert.deepEqual(result.policy.skillIds, ['novel-pacing', 'novel-language-style'])
  assert.deepEqual(result.missingRoles, [])
})

test('非仙侠项目不套用仙侠架构，改用通用结构 Skill', () => {
  const result = resolveSkillPreset('draft', skills, '都市言情')
  assert.deepEqual(result.policy.skillIds, ['novel-pacing', '我吃西红柿笔锋'])
})
