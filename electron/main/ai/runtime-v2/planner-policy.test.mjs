import assert from 'node:assert/strict'
import test from 'node:test'

import { createRuntimePlan } from './planner.ts'

const surface = {
  id: 'global-page',
  scope: 'project',
  autoCommit: false,
  maxSteps: 12
}

test('全项目任务使用可续批的项目级读取预算', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请完整审计整个项目的所有设定'
    }
  })

  assert.equal(plan.enforceToolBudgets, true)
  assert.equal(plan.requiresBatching, true)
  assert.equal(plan.maxReadToolCalls, 8)
  assert.equal(plan.maxSearchToolCalls, 3)
})

test('普通项目任务限制扩读，但不强制分批', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '基于最新一章继续创作下一章'
    }
  })

  assert.equal(plan.enforceToolBudgets, true)
  assert.equal(plan.requiresBatching, false)
  assert.equal(plan.maxReadToolCalls, 6)
  assert.equal(plan.maxSearchToolCalls, 3)
  assert.ok(plan.contextProviders.includes('project-digest'))
  assert.ok(plan.contextProviders.includes('style-fingerprint'))
})

test('人物修改只预载明确相关资料域，不再把全部项目模块塞入提示词', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '修改人物唐烈的人设和所属学院'
    }
  })

  assert.ok(plan.contextProviders.includes('project-digest'))
  assert.ok(plan.contextProviders.includes('characters'))
  assert.ok(plan.contextProviders.includes('organizations'))
  assert.ok(!plan.contextProviders.includes('worldview'))
  assert.ok(!plan.contextProviders.includes('outline'))
})

test('全局大纲批量修改允许单批暂存三十项', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '按照刚才的方案调整第二卷大纲，合并重复节点并补齐剩余节点'
    }
  })

  assert.equal(plan.intent, 'entity-edit')
  assert.equal(plan.maxStageChanges, 30)
})

test('已确认后生成第三卷大纲属于大纲编辑，并给予完整节点批次预算', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '好的已经确认写回了，现在可以生成大纲了',
      intentHint: 'outline:ingest'
    }
  })

  assert.equal(plan.intent, 'entity-edit')
  assert.equal(plan.maxReadToolCalls, 16)
  assert.equal(plan.maxSearchToolCalls, 10)
  assert.equal(plan.maxStageChanges, 30)
  assert.equal(plan.maxModelCalls, 40)
  assert.equal(plan.continuationLabel, '继续生成下一批大纲')
  assert.match(plan.continuationPrompt, /不重复创建/)
  assert.match(plan.guidance, /搜索达到上限.*继续暂存/)
  assert.match(plan.guidance, /单批最多暂存 30 项/)
})

test('设计分卷详情也使用大纲任务预算', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请设计并创建第三卷的分卷详情'
    }
  })

  assert.equal(plan.intent, 'entity-edit')
  assert.equal(plan.maxReadToolCalls, 16)
  assert.equal(plan.maxSearchToolCalls, 10)
  assert.equal(plan.maxStageChanges, 30)
  assert.equal(plan.maxModelCalls, 40)
})

test('只说设计第三卷时也识别为分卷任务', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请设计第三卷的详细剧情'
    }
  })

  assert.equal(plan.intent, 'entity-edit')
  assert.equal(plan.maxSearchToolCalls, 10)
  assert.ok(plan.contextProviders.includes('outline'))
})

test('含伏笔的大纲生成仍是创建任务，审计已生成大纲仍是审计任务', () => {
  const request = { sessionId: 'session-1', surface }
  const create = createRuntimePlan({
    surface,
    request: { ...request, userMessage: '请生成包含伏笔回收的第三卷大纲' }
  })
  const audit = createRuntimePlan({
    surface,
    request: { ...request, userMessage: '请审计已生成的第三卷大纲是否有矛盾' }
  })

  assert.equal(create.intent, 'entity-edit')
  assert.equal(audit.intent, 'audit')
})

test('明确拆分后续章节时按章节实体批量创建，不沿用大纲录入意图', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '确认了，你继续拆分后续章节吧',
      intentHint: 'outline:ingest'
    }
  })

  assert.equal(plan.intent, 'edit')
  assert.equal(plan.maxStageChanges, 12)
  assert.match(plan.guidance, /stage_chapter_create/)
  assert.match(plan.guidance, /实际.*额度.*拒绝/)
  assert.match(plan.continuationPrompt, /章节/)
})

test('全局录入长篇设定不在第五项暂存后强制续轮', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1', surface,
      userMessage: '贯穿全书的三大悬念，以及对应人物、组织、世界观和开篇设定，请一起录入',
      intentHint: 'global-assistant-v2:ingest'
    }
  })

  assert.equal(plan.intent, 'ingest')
  assert.ok(plan.maxStageChanges >= 20)
  assert.ok(plan.maxReadToolCalls >= 12)
  assert.ok(plan.maxSearchToolCalls >= 6)
  assert.ok(plan.maxModelCalls >= 30)
})

test('全局长篇章节规划即使命中编辑意图，也能暂存完整批次', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1', surface,
      userMessage: `开篇三章节奏\n第一章：死亡与重生\n第二章：新的能力\n第三章：旧敌出现\n${'人物关系与剧情节奏。'.repeat(25)}`,
      intentHint: 'global-assistant-v2:ingest'
    }
  })

  assert.ok(plan.maxStageChanges >= 20)
  assert.ok(plan.maxModelCalls >= 30)
})

test('简短的继续请求继承录入意图后仍有完整暂存和读取预算', () => {
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1', surface,
      userMessage: '继续',
      intentHint: 'global-assistant-v2:ingest'
    }
  })

  assert.equal(plan.intent, 'ingest')
  assert.ok(plan.maxStageChanges >= 20)
  assert.ok(plan.maxReadToolCalls >= 12)
})
