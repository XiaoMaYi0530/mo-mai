import assert from 'node:assert/strict'
import test from 'node:test'

import { AgentLoopCore } from './agent-loop-core.ts'
import { createEvidenceLedger, wrapToolsWithRuntimeBudget } from './evidence-ledger.ts'
import { createRuntimePlan } from './planner.ts'
import { StagedChangesStore } from './staged-changes-store.ts'

function makeConversation() {
  const persistedEvents = []
  const statusUpdates = []
  return {
    persistedEvents,
    statusUpdates,
    createTurn({ sessionId, userMessage }) {
      return { id: 'turn-1', sessionId, userMessage }
    },
    appendEvent(turnId, event) {
      const persisted = { ...event, turnId, seq: persistedEvents.length + 1 }
      persistedEvents.push(persisted)
      return persisted
    },
    updateTurnStatus(turnId, status, finalText) {
      statusUpdates.push({ turnId, status, finalText })
    }
  }
}

function makeOptions(signal) {
  return {
    session: { id: 'session-1', projectId: 'project-1' },
    surface: {
      id: 'global-assistant',
      scope: 'project',
      autoCommit: false,
      maxSteps: 8
    },
    turnInput: { userMessage: '测试请求' },
    systemPrompt: '系统提示',
    tools: [],
    settings: {},
    signal
  }
}

function makeLoop(runAgentImpl) {
  const conversation = makeConversation()
  const pushedEvents = []
  const loop = new AgentLoopCore(
    conversation,
    new StagedChangesStore(),
    (event) => pushedEvents.push(event),
    runAgentImpl,
    () => false
  )
  return { loop, conversation, pushedEvents }
}

test('项目级全局助手对全项目任务分批并限制资料读取', async () => {
  const surface = {
    id: 'global-page',
    scope: 'project',
    autoCommit: false,
    maxSteps: 8
  }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请完整审计整个项目的所有设定'
    }
  })
  const ledger = createEvidenceLedger()
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'read_project_data' },
    handler: async () => ({ content: 'ok' })
  }], plan, ledger)

  for (let index = 0; index < 8; index += 1) {
    assert.equal((await tool.handler({}, {})).content, 'ok')
  }
  assert.match((await tool.handler({}, {})).content, /读取次数已达上限/)

  assert.equal(plan.enforceToolBudgets, true)
  assert.equal(plan.requiresBatching, true)
  assert.match(plan.guidance, /每批读取预算有限/)
  assert.equal(ledger.snapshot().readCalls, 8)
  assert.equal(ledger.snapshot().budgetExhausted, true)
})

test('大纲任务搜索触顶后仍允许基于已确认信息暂存节点', async () => {
  const surface = { id: 'global-page', scope: 'project', autoCommit: false, maxSteps: 12 }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '好的已经确认写回了，现在可以生成大纲了',
      intentHint: 'outline:ingest'
    }
  })
  const ledger = createEvidenceLedger()
  const [search, stage] = wrapToolsWithRuntimeBudget([
    { definition: { name: 'search_project' }, handler: async () => ({ content: '搜索结果' }) },
    { definition: { name: 'stage_outline' }, handler: async () => ({ content: '已暂存大纲' }) }
  ], plan, ledger)

  for (let index = 0; index < plan.maxSearchToolCalls; index += 1) {
    assert.equal((await search.handler({}, {})).content, '搜索结果')
  }
  const blocked = await search.handler({}, {})
  assert.match(blocked.content, /搜索次数已达上限/)
  assert.match(blocked.content, /继续.*暂存/)
  for (let index = 0; index < plan.maxStageChanges; index += 1) {
    assert.equal((await stage.handler({}, {})).content, '已暂存大纲')
  }
  assert.match((await stage.handler({}, {})).content, /暂存变更数量已达上限/)
  assert.equal(ledger.snapshot().stageCalls, 30)
})

test('全局录入允许连续暂存超过旧的五项限制', async () => {
  const surface = { id: 'global-page', scope: 'project', autoCommit: false, maxSteps: 12 }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1', surface,
      userMessage: '继续录入这些人物、组织与世界观设定',
      intentHint: 'global-assistant-v2:ingest'
    }
  })
  const ledger = createEvidenceLedger()
  const [stage] = wrapToolsWithRuntimeBudget([
    { definition: { name: 'stage_character' }, handler: async () => ({ content: '已暂存人物' }) }
  ], plan, ledger)

  for (let index = 0; index < 20; index += 1) {
    assert.equal((await stage.handler({}, {})).content, '已暂存人物')
  }
  assert.match((await stage.handler({}, {})).content, /暂存变更数量已达上限（20 项）/)
  assert.equal(ledger.snapshot().stageCalls, 20)
})

test('项目级全局助手允许完整读取章节正文', async () => {
  const surface = {
    id: 'global-page',
    scope: 'project',
    autoCommit: false,
    maxSteps: 8
  }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请分析第三章后半部分'
    }
  })
  const ledger = createEvidenceLedger()
  let receivedArgs = null
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'read_chapter' },
    handler: async (input) => {
      receivedArgs = input
      return { content: 'ok' }
    }
  }], plan, ledger)

  await tool.handler({ chapter_id: 'chapter-1' }, {})

  assert.equal(plan.allowFullChapterRead, true)
  assert.notEqual(receivedArgs.include_content, false)
})

test('项目级全局助手对目标章节的 read_project_data 不强制降级为预览', async () => {
  const surface = {
    id: 'global-page',
    scope: 'project',
    autoCommit: false,
    maxSteps: 8
  }
  const plan = createRuntimePlan({
    surface,
    request: {
      sessionId: 'session-1',
      surface,
      userMessage: '请分析第三章后半部分'
    }
  })
  const ledger = createEvidenceLedger()
  let receivedArgs = null
  const [tool] = wrapToolsWithRuntimeBudget([{
    definition: { name: 'read_project_data' },
    handler: async (input) => {
      receivedArgs = input
      return { content: 'ok' }
    }
  }], plan, ledger)

  await tool.handler({ entity_type: 'chapters', entity_id: 'chapter-1' }, {})

  assert.equal(receivedArgs.summary_only, undefined)
})

test('模型没有最终可见文本时将 turn 标记为 error', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async () => ({
    finalText: '   ',
    toolCalls: [],
    iterations: 2,
    usage: { totalTokens: 42 }
  }))

  const result = await loop.run(makeOptions(new AbortController().signal))

  assert.equal(result.status, 'error')
  assert.match(result.error, /模型未产出可见回复/)
  assert.equal(pushedEvents.at(-1).event.kind, 'error')
  assert.match(pushedEvents.at(-1).event.error, /iterations=2/)
  assert.deepEqual(conversation.statusUpdates, [{
    turnId: 'turn-1',
    status: 'error',
    finalText: '   '
  }])
})

test('工具失败同时写入事件和 toolCalls 结果', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async (params) => {
    params.handlers.onToolUseStart('tool-use-1', 'read_chapter', { chapterId: 'chapter-1' })
    params.handlers.onToolResult(
      'tool-use-1',
      'read_chapter',
      '章节不存在',
      true,
      17
    )
    return {
      finalText: '读取章节失败，请检查目标章节。',
      toolCalls: [],
      iterations: 1
    }
  })

  const result = await loop.run(makeOptions(new AbortController().signal))

  assert.equal(result.status, 'done')
  assert.deepEqual(result.toolCalls, [{
    tool: 'read_chapter',
    args: { chapterId: 'chapter-1' },
    durationMs: 17,
    status: 'error',
    error: '章节不存在'
  }])
  assert.deepEqual(
    pushedEvents.map((event) => event.event.kind),
    ['tool_use_start', 'tool_result', 'done']
  )
  assert.equal(pushedEvents[1].event.isError, true)
  assert.equal(conversation.statusUpdates[0].status, 'done')
})

test('连续文本增量合并后再落盘和推送', async () => {
  const { loop, conversation, pushedEvents } = makeLoop(async (params) => {
    params.handlers.onTextDelta('第一段')
    params.handlers.onTextDelta('，第二段')
    return {
      finalText: '第一段，第二段',
      toolCalls: [],
      iterations: 1
    }
  })

  const result = await loop.run(makeOptions(new AbortController().signal))

  assert.equal(result.status, 'done')
  assert.deepEqual(
    pushedEvents.map((event) => event.event.kind),
    ['chunk', 'done']
  )
  assert.equal(pushedEvents[0].event.delta, '第一段，第二段')
  assert.equal(conversation.persistedEvents.length, 2)
})

test('运行被中止时发送 canceled 事件并更新 turn 状态', async () => {
  const controller = new AbortController()
  const { loop, conversation, pushedEvents } = makeLoop(async () => {
    controller.abort()
    throw new Error('aborted')
  })

  const result = await loop.run(makeOptions(controller.signal))

  assert.equal(result.status, 'canceled')
  assert.equal(result.error, undefined)
  assert.equal(pushedEvents.at(-1).event.kind, 'canceled')
  assert.deepEqual(conversation.statusUpdates, [{
    turnId: 'turn-1',
    status: 'canceled',
    finalText: ''
  }])
})

test('检查全部人物先逐批审查，再汇总，读取记录与用量完整保存', async () => {
  const batches = [
    { module:'characters',total:3,items:[{id:'a',title:'甲',mode:'full',from:0,to:1,total:1},{id:'b',title:'乙',mode:'full',from:0,to:1,total:1}],nextCursor:1 },
    { module:'characters',total:3,items:[{id:'c',title:'丙',mode:'full',from:0,to:1,total:1}] }
  ]
  const prompts=[]
  const {loop,conversation}=makeLoop(async params=>{
    prompts.push(params.userPrompt)
    return {finalText: prompts.length<3?'本批核对记录':'全部人物汇总',iterations:1,toolCalls:[],usage:{totalTokens:10,cachedInputTokens:2}}
  })
  const options=makeOptions(new AbortController().signal)
  options.turnInput.userMessage='检查全部人物卡'
  options.tools=[{definition:{name:'read_project_data'},handler:async args=>({content:'MO_MAI_READ_RECEIPT '+JSON.stringify(batches[args.scan_cursor])+'\n人物资料'})}]
  const result=await loop.run(options)
  assert.equal(result.status,'done')
  assert.equal(prompts.length,3)
  assert.match(prompts[2],/本批核对记录/)
  const events=conversation.persistedEvents.filter(e=>e.kind==='tool_result')
  assert.equal(events.length,2)
  assert.match(events[1].content,/丙/)
  assert.equal(result.usage.totalTokens,30)
  assert.equal(result.usage.cachedInputTokens,6)
})
