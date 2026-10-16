import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { normalizeSkillUsePolicy } from '../../../shared/assistant-runtime.ts'

test('Skill 策略规范化支持自动、仅使用和不使用三态', () => {
  assert.deepEqual(normalizeSkillUsePolicy(undefined), { mode: 'auto', skillIds: [] })
  assert.deepEqual(normalizeSkillUsePolicy({ mode: 'only', skillIds: ['a', 'a', '', ' b '] }), {
    mode: 'only',
    skillIds: ['a', 'b']
  })
  assert.deepEqual(normalizeSkillUsePolicy({ mode: 'off', skillIds: ['a'] }), {
    mode: 'off',
    skillIds: ['a']
  })
  assert.deepEqual(normalizeSkillUsePolicy({ mode: 'only', skillIds: ['a'], presetId: ' outline ' }), {
    mode: 'only',
    skillIds: ['a'],
    presetId: 'outline'
  })
})

test('Skill 工具统一在解析入口校验本轮执行授权', () => {
  const source = readFileSync(new URL('../agent/tools/skill-tools.ts', import.meta.url), 'utf8')
  assert.match(source, /opts\.allowSkillUse\?\.\(skill\) \?\? enabled/)
  assert.match(source, /当前执行策略不允许使用 skill/)
})

test('自动模式允许按需加载已启用的非候选 Skill，固定模式仍限制清单', () => {
  for (const path of ['../agent/streaming-orchestrator.ts', '../runtime-v2/execution-plan.ts']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /allowSkillUse: \(skill\) => skill\.compatibility !== 'external-only'\s*&& \(skillPolicy\.mode !== 'only' \|\| allowedSkillIds\.has\(skill\.id\)\)/)
  }
})

test('Skill 清单区分项目启用与本轮允许使用', () => {
  const source = readFileSync(new URL('../agent/tools/skill-tools.ts', import.meta.url), 'utf8')
  assert.match(source, /本轮：\$\{allowed \? '可用' : '不可用'\}/)
  assert.match(source, /当前项目未启用 skill/)
})

test('固定使用的 Skill 全部不适用当前阶段时不应中断助手请求', () => {
  const selectionSource = readFileSync(new URL('./task-selection.ts', import.meta.url), 'utf8')
  const plannerSource = readFileSync(new URL('../runtime-v2/execution-plan.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(selectionSource, /“仅使用”模式未能加载任何 Skill/)
  assert.doesNotMatch(plannerSource, /“仅使用”模式未能加载任何 Skill/)
  assert.match(plannerSource, /固定使用的 Skill 均不适用当前任务，将不注入 Skill/)
})
