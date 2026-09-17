import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSkillGenreLabels, matchSkillGenre } from './skill-genres.ts'

test('通用 Skill 使用统一的通用题材名称', () => {
  assert.equal(formatSkillGenreLabels([]), '通用题材')
  assert.equal(formatSkillGenreLabels(['general']), '通用题材')
  assert.equal(matchSkillGenre(['general'], '科幻'), 'general')
})

test('题材专用 Skill 只匹配对应项目', () => {
  assert.equal(matchSkillGenre(['xianxia', 'xuanhuan'], '东方玄幻修仙长篇'), 'match')
  assert.equal(matchSkillGenre(['xianxia'], '都市言情'), 'mismatch')
  assert.equal(matchSkillGenre(['xianxia'], ''), 'unknown-project')
})
