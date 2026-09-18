import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildAssistantSystemPrompt } from './system-prompt.ts'
import { createRuntimePlan } from './planner.ts'

test('选区改写在不依赖 Skill 的情况下仍获得正文可读性与事实边界', () => {
  const surface = { id: 'chapter-panel', scope: 'chapter' }
  const userMessage = '【选中内容】\n“风口太死。兽要是进来，跑不开。”\n\n【用户指令】\n改写以上选中内容'
  const plan = createRuntimePlan({ surface, request: { userMessage } })
  assert.equal(plan.intent, 'edit')
  const prompt = buildAssistantSystemPrompt({
    surface,
    intentHint: 'chapter-panel:polish',
    contextBlock: userMessage,
    writingEdit: plan.intent === 'edit'
  })
  assert.match(prompt, /简洁不能省掉首次出现的动作对象/)
  assert.match(prompt, /保留情节事实/)
  assert.match(prompt, /不把推测改成确定事实/)
})

test('非正文编辑的问答不额外注入改写规则', () => {
  const prompt = buildAssistantSystemPrompt({
    surface: { id: 'chapter-panel' },
    contextBlock: '普通问答',
    writingEdit: false
  })
  assert.doesNotMatch(prompt, /简洁不能省掉首次出现的动作对象/)
})

test('正文编辑执行计划会启用共享可读性底线', () => {
  const source = readFileSync(new URL('./execution-plan.ts', import.meta.url), 'utf8')
  assert.match(source, /writingEdit: runtimePlan\.intent === 'edit'/)
})
