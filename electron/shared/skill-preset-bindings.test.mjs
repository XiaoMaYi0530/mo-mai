import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeSkillPresetBindings,
  orderSkillsByPresetBinding,
  resetSkillPresetBinding,
  resolveSkillPreset,
  updateSkillPresetBinding
} from './skill-presets.ts'

const skills = [
  { id: 'architecture', name: '题材架构' },
  { id: 'prose', name: '自然文风' },
  { id: 'pacing', name: '章节节奏' }
]

test('项目绑定覆盖内置预设，并允许明确保存空组合', () => {
  const customized = resolveSkillPreset('draft', skills, '', { draft: ['pacing', 'prose'] })
  assert.equal(customized.customized, true)
  assert.deepEqual(customized.policy.skillIds, ['pacing', 'prose'])
  assert.equal(customized.policy.presetId, 'draft')

  const empty = resolveSkillPreset('draft', skills, '', { draft: [] })
  assert.equal(empty.customized, true)
  assert.deepEqual(empty.policy.skillIds, [])
  assert.deepEqual(empty.missingRoles, ['尚未绑定 Skill'])
})

test('绑定写入、清洗与恢复默认不会污染其他预设', () => {
  const updated = updateSkillPresetBinding({ polish: ['prose'] }, 'draft', ['pacing', 'pacing', ''])
  assert.deepEqual(updated, { polish: ['prose'], draft: ['pacing'] })
  assert.deepEqual(normalizeSkillPresetBindings({ draft: [' pacing ', null], unknown: ['x'] }), { draft: ['pacing'] })
  assert.deepEqual(resetSkillPresetBinding(updated, 'draft'), { polish: ['prose'] })
})

test('已绑定 Skill 按绑定顺序置顶，未绑定 Skill 保持原顺序', () => {
  const ordered = orderSkillsByPresetBinding(skills, ['pacing', 'architecture'])
  assert.deepEqual(ordered.map((skill) => skill.id), ['pacing', 'architecture', 'prose'])
})
