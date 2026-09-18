import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFirstDraftSkillDefault } from './firstDraftSkillDefaults.ts'

test('初稿优先遵循项目固定或禁用策略', () => {
  const bindings = { draft: ['draft-skill'] }
  assert.deepEqual(resolveFirstDraftSkillDefault({ mode: 'only', skillIds: ['project-skill'] }, bindings), {
    mode: 'only', skillIds: ['project-skill']
  })
  assert.deepEqual(resolveFirstDraftSkillDefault({ mode: 'off', skillIds: [] }, bindings), {
    mode: 'off', skillIds: []
  })
})

test('项目自动策略使用正文创作绑定，没有绑定仍为自动', () => {
  assert.deepEqual(resolveFirstDraftSkillDefault({ mode: 'auto', skillIds: [] }, { draft: ['draft-skill'] }), {
    mode: 'only', skillIds: ['draft-skill'], presetId: 'draft'
  })
  assert.deepEqual(resolveFirstDraftSkillDefault({ mode: 'auto', skillIds: [] }, {}), {
    mode: 'auto', skillIds: []
  })
})
