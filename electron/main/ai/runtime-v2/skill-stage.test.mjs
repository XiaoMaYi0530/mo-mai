import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveSkillStage } from './skill-stage.ts'

const surface = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 12
}

const chatPlan = { intent: 'chat' }

test('本轮明确提到大纲时识别为大纲阶段', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '调整第二卷大纲', undefined, undefined), 'outline')
})

test('只说设计第三卷时也识别为大纲阶段', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '请设计第三卷的详细剧情', undefined, undefined), 'outline')
})

test('模糊追问继承当前大纲设计快捷组合', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '调整一下', 'outline', undefined), 'outline')
})

test('没有组合标识时模糊追问继承上一轮成功阶段', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '继续', undefined, 'outline'), 'outline')
})

test('明确切换到正文时覆盖大纲组合和上一轮阶段', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '按这个大纲开始写第一章正文', 'outline', 'outline'), 'draft')
})

test('参考拆书创作网游战斗正文时按正文阶段选择 Skill', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '参考拆书里的网游战斗节奏，写第一章正文', undefined, 'reference'), 'draft')
})

test('明确拆分后续章节时覆盖前一轮大纲阶段', () => {
  assert.equal(resolveSkillStage(chatPlan, surface, '确认了，你继续拆分后续章节吧', 'outline', 'outline'), 'draft')
})
