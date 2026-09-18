import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourcePath = fileURLToPath(new URL('../../stores/app.ts', import.meta.url))

function createHarness({ holdFirstResponse = false, backendInitiallyBusy = false, externalTaskStatus = 'running' } = {}) {
  const source = readFileSync(sourcePath, 'utf8')
  const start = source.indexOf('  function backfillTaskKey(')
  const end = source.indexOf('  function getChapterPostGenerationIssues(', start)
  assert.ok(start >= 0 && end > start, '应找到真实的故事状态同步入口')
  const code = ts.transpileModule(source.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }
  }).outputText

  const requests = []
  let releaseFirstResponse = () => {}
  const firstResponseGate = holdFirstResponse
    ? new Promise((resolve) => { releaseFirstResponse = resolve })
    : null
  const aiTaskRuns = { value: new Map() }
  const deps = {
    aiTaskRuns,
    selectedProjectId: { value: 'project-1' },
    appSettings: { value: {} },
    AI_TASK_RETENTION_MS: 1000,
    toIpcPayload: (payload) => payload,
    isAiTaskRunning: (key) => aiTaskRuns.value.get(key)?.stage === 'running',
    replaceTaskRuns: (update) => {
      const next = new Map(aiTaskRuns.value)
      update(next)
      aiTaskRuns.value = next
    },
    registerManualTask: ({ key, ...task }) => aiTaskRuns.value.set(key, { ...task, key, stage: 'running' }),
    finalizeManualTask: (key, stage, error) => aiTaskRuns.value.set(key, { key, stage, error }),
    window: {
      setTimeout: () => 0,
      characterArc: {
        readBackfillTaskStatus: async (projectId) => ({
          success: true,
          result: {
            taskId: 'external-task', projectId, status: externalTaskStatus, current: 0, total: 1,
            phase: 'starting', message: '其他窗口正在同步', startedAt: new Date().toISOString()
          }
        }),
        backfillProjectState: async (request) => {
          requests.push(request)
          if (backendInitiallyBusy && requests.length === 1) {
            return { success: false, error: '该项目已有状态补录任务正在进行。' }
          }
          if (requests.length === 1 && firstResponseGate) await firstResponseGate
          return {
            success: true,
            result: {
              taskId: `task-${requests.length}`,
              projectId: request.projectId,
              status: 'running',
              current: 0,
              total: 1,
              phase: 'starting',
              message: '正在准备',
              startedAt: new Date().toISOString()
            }
          }
        }
      }
    }
  }
  const factory = new Function('deps', `
    const { aiTaskRuns, selectedProjectId, appSettings, AI_TASK_RETENTION_MS,
      toIpcPayload, isAiTaskRunning, replaceTaskRuns, registerManualTask,
      finalizeManualTask, window } = deps;
    ${code}
    return { startChapterStateSync, handleBackfillStateProgress };
  `)
  return { ...factory(deps), requests, aiTaskRuns, releaseFirstResponse }
}

test('连续定稿两章时，第二章等待首章同步完成后再启动，不报已有任务', async () => {
  const harness = createHarness()
  await harness.startChapterStateSync(['chapter-1'])
  await harness.startChapterStateSync(['chapter-2'])

  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [['chapter-1']])
  harness.handleBackfillStateProgress({
    taskId: 'task-1',
    projectId: 'project-1',
    status: 'completed',
    current: 1,
    total: 1,
    phase: 'done',
    message: '已完成',
    startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'],
    ['chapter-2']
  ])
})

test('运行中合并重复章节，任务面板显示排队数量', async () => {
  const harness = createHarness()
  await harness.startChapterStateSync(['chapter-1'])
  await harness.startChapterStateSync(['chapter-1', 'chapter-2', 'chapter-2', 'chapter-3'])
  await harness.startChapterStateSync(['chapter-3'])

  assert.match(harness.aiTaskRuns.value.get('chapter-state-backfill:project-1').description, /后续排队 2 章/)
  harness.handleBackfillStateProgress({
    taskId: 'task-1', projectId: 'project-1', status: 'completed',
    current: 1, total: 1, phase: 'done', message: '已完成', startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'],
    ['chapter-2', 'chapter-3']
  ])
})

test('首个任务启动请求尚未返回时，第二章仍可排队', async () => {
  const harness = createHarness({ holdFirstResponse: true })
  const first = harness.startChapterStateSync(['chapter-1'])
  await harness.startChapterStateSync(['chapter-2'])
  assert.equal(harness.requests.length, 1)
  harness.releaseFirstResponse()
  await first

  harness.handleBackfillStateProgress({
    taskId: 'task-1', projectId: 'project-1', status: 'completed',
    current: 1, total: 1, phase: 'done', message: '已完成', startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'],
    ['chapter-2']
  ])
})

test('完成事件早于启动响应时，不被过期运行状态覆盖，继续下一章', async () => {
  const harness = createHarness({ holdFirstResponse: true })
  const first = harness.startChapterStateSync(['chapter-1'])
  await harness.startChapterStateSync(['chapter-2'])
  harness.handleBackfillStateProgress({
    taskId: 'task-1', projectId: 'project-1', status: 'completed',
    current: 1, total: 1, phase: 'done', message: '已完成', startedAt: new Date().toISOString()
  })
  harness.releaseFirstResponse()
  await first
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'],
    ['chapter-2']
  ])
})

test('前一批同步失败后，已排队章节仍继续启动', async () => {
  const harness = createHarness()
  await harness.startChapterStateSync(['chapter-1'])
  await harness.startChapterStateSync(['chapter-2'])
  harness.handleBackfillStateProgress({
    taskId: 'task-1', projectId: 'project-1', status: 'failed',
    current: 1, total: 1, phase: 'done', message: '同步失败', error: '首章失败',
    startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'],
    ['chapter-2']
  ])
})

test('主进程已有其他窗口的同步任务时，当前章节等其完成再启动', async () => {
  const harness = createHarness({ backendInitiallyBusy: true })
  await harness.startChapterStateSync(['chapter-1'])
  assert.equal(harness.requests.length, 1)
  harness.handleBackfillStateProgress({
    taskId: 'external-task', projectId: 'project-1', status: 'completed',
    current: 1, total: 1, phase: 'done', message: '已完成', startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'],
    ['chapter-1']
  ])
})

test('旧任务的迟到进度不会覆盖新任务并卡住后续队列', async () => {
  const harness = createHarness()
  await harness.startChapterStateSync(['chapter-1'])
  await harness.startChapterStateSync(['chapter-2'])
  harness.handleBackfillStateProgress({
    taskId: 'task-1', projectId: 'project-1', status: 'completed',
    current: 1, total: 1, phase: 'done', message: '已完成', startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  await harness.startChapterStateSync(['chapter-3'])
  harness.handleBackfillStateProgress({
    taskId: 'task-1', projectId: 'project-1', status: 'running',
    current: 1, total: 1, phase: 'applying', message: '迟到进度', startedAt: new Date().toISOString()
  })
  harness.handleBackfillStateProgress({
    taskId: 'task-2', projectId: 'project-1', status: 'completed',
    current: 1, total: 1, phase: 'done', message: '已完成', startedAt: new Date().toISOString()
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'], ['chapter-2'], ['chapter-3']
  ])
})

test('外部任务刚好结束时，冲突请求自动重试而不是报错', async () => {
  const harness = createHarness({ backendInitiallyBusy: true, externalTaskStatus: 'completed' })
  await harness.startChapterStateSync(['chapter-1'])
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(harness.requests.map((request) => request.selection.chapterIds), [
    ['chapter-1'], ['chapter-1']
  ])
})
