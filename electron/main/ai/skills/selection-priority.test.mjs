import assert from 'node:assert/strict'
import test from 'node:test'
import { isSkillAllowedAtStage, resolveAutoSkillLimit, selectSkillCandidates } from './selection-priority.ts'
import { findSkillDefinitionByIdOrName } from './registry-merge.ts'

function entry(id, name, total, required = false, exclusiveGroup) {
  return {
    skill: {
      id,
      name,
      manifest: { required, exclusiveGroup }
    },
    breakdown: { total }
  }
}

const compare = (a, b) => b.breakdown.total - a.breakdown.total

test('自动模式中用户点名的 Skill 不会被高分候选和数量上限挤掉', () => {
  const entries = [
    entry('project-baseline', '项目基础规则', 20, true),
    entry('novel-pacing', 'novel-pacing', 15),
    entry('novel-emotion', 'novel-emotion', 14),
    entry('novel-language-style', 'novel-language-style', 13),
    entry('style-fusion', '风格融合指南', 12),
    entry('novel-pleasure-points', 'novel-pleasure-points', 11),
    entry('我吃西红柿笔锋', '我吃西红柿笔锋', 0)
  ]

  const selected = selectSkillCandidates(
    entries,
    '继续创作章节，写作优先使用我吃西红柿笔锋',
    6,
    compare
  )

  assert.equal(selected.length, 6)
  assert.ok(selected.some((item) => item.skill.id === '我吃西红柿笔锋'))
  assert.ok(selected.some((item) => item.skill.id === 'project-baseline'))
})

test('自动模式同一互斥组只保留评分更高的一项', () => {
  const selected = selectSkillCandidates([
    entry('natural-prose', '人物驱动自然文风', 12, false, 'prose-style'),
    entry('language-style', '语言与文风', 9, false, 'prose-style'),
    entry('pacing', '章节节奏与结构', 8)
  ], '创作正文', 3, compare)

  assert.deepEqual(selected.map((item) => item.skill.id), ['natural-prose', 'pacing'])
})

test('仅使用模式也能按当前阶段过滤 Skill', () => {
  const draftSkill = { id: 'draft', name: '正文文风', manifest: { stages: ['draft'] } }
  assert.equal(isSkillAllowedAtStage(draftSkill, 'draft'), true)
  assert.equal(isSkillAllowedAtStage(draftSkill, 'outline'), false)
  assert.equal(isSkillAllowedAtStage(draftSkill, 'outline', ['outline']), true)
  assert.equal(isSkillAllowedAtStage({ id: 'all', name: '通用', manifest: { stages: [] } }, 'setting'), true)
})

test('自动模式按阶段限制 Skill 数量', () => {
  assert.equal(resolveAutoSkillLimit('reference'), 1)
  assert.equal(resolveAutoSkillLimit('draft'), 2)
  assert.equal(resolveAutoSkillLimit('outline'), 3)
  assert.equal(resolveAutoSkillLimit(''), 3)
})

test('显示名称与目录 ID 不同时，点名显示名称也能优先并被工具解析', () => {
  const named = entry('fiction-human-texture', '我吃西红柿笔锋', 0)
  const selected = selectSkillCandidates([named], '请优先使用我吃西红柿笔锋', 4, compare)
  assert.equal(selected[0]?.skill.id, 'fiction-human-texture')
  assert.equal(
    findSkillDefinitionByIdOrName([named.skill], '我吃西红柿笔锋')?.id,
    'fiction-human-texture'
  )
})
