import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeScannedSkillSources } from './promoted-builtins.ts'

test('迁入内置的两项 Skill 不再被本机导入副本覆盖，其他自定义覆盖保持原行为', () => {
  const builtin = [
    { id: '我吃西红柿笔锋', name: '人物驱动自然文风', scope: 'builtin' },
    { id: '我吃西红柿架构', name: '仙侠升级流架构', scope: 'builtin' },
    { id: 'customizable', name: '可覆盖', scope: 'builtin' }
  ]
  const imported = builtin.map((skill) => ({ ...skill, scope: 'project' }))
  const merged = mergeScannedSkillSources(builtin, imported)
  assert.equal(merged.find((skill) => skill.id === '我吃西红柿笔锋').scope, 'builtin')
  assert.equal(merged.find((skill) => skill.id === '我吃西红柿架构').scope, 'builtin')
  assert.equal(merged.find((skill) => skill.id === 'customizable').scope, 'project')
  assert.equal(merged.length, 3)
})
