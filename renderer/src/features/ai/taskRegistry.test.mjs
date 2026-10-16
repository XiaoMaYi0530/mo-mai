import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyExternalAiTaskEvent,
  getAiTaskResultError,
  restoreAiTaskRuns,
  serializeAiTaskRuns
} from './taskRegistry.ts'

function event(runId, stage) {
  return {
    taskKey: 'chapter-post-process:project-1:chapter-1',
    runId,
    stage,
    label: '章节后处理',
    startedAt: 100,
    finishedAt: stage === 'running' ? undefined : 200
  }
}

test('应用重启后把运行中任务恢复为可重试的中断记录', () => {
  const startedAt = 100
  const serialized = serializeAiTaskRuns(new Map([['deep', {
    key: 'deep', kind: 'reference', label: '深度拆书', startedAt, stage: 'running', onCancel: () => {}
  }]]))
  assert.doesNotMatch(serialized, /onCancel/)
  assert.doesNotMatch(serialized, /onOpen/)
  const restored = restoreAiTaskRuns(serialized, 200)
  assert.equal(restored.get('deep')?.stage, 'error')
  assert.match(restored.get('deep')?.error ?? '', /中断/)
})

test('业务返回 success false 时任务必须判定失败', () => {
  assert.equal(getAiTaskResultError({ success: true }), null)
  assert.equal(getAiTaskResultError({ success: false, error: '图片生成失败' }), '图片生成失败')
  assert.equal(getAiTaskResultError({ success: false }), 'AI 任务执行失败')
  assert.equal(getAiTaskResultError('普通结果'), null)
})

test('主进程后台任务事件可从 running 收敛到 done', () => {
  const running = applyExternalAiTaskEvent(new Map(), event('run-a', 'running'))
  const done = applyExternalAiTaskEvent(running, event('run-a', 'done'))
  const task = done.get(event('run-a', 'done').taskKey)

  assert.equal(task.stage, 'done')
  assert.equal(task.runId, 'run-a')
  assert.equal(task.finishedAt, 200)
})

test('旧任务迟到的终态不会覆盖新任务', () => {
  const oldRunning = applyExternalAiTaskEvent(new Map(), event('run-a', 'running'))
  const newRunning = applyExternalAiTaskEvent(oldRunning, event('run-b', 'running'))
  const afterOldCanceled = applyExternalAiTaskEvent(newRunning, event('run-a', 'canceled'))
  const task = afterOldCanceled.get(event('run-b', 'running').taskKey)

  assert.equal(afterOldCanceled, newRunning)
  assert.equal(task.stage, 'running')
  assert.equal(task.runId, 'run-b')
})

test('相同内容的重试使用新 runId 时不受上一轮终态影响', () => {
  const firstDone = applyExternalAiTaskEvent(
    applyExternalAiTaskEvent(new Map(), event('run-a', 'running')),
    event('run-a', 'done')
  )
  const retryRunning = applyExternalAiTaskEvent(firstDone, {
    ...event('run-b', 'running'),
    startedAt: 300
  })
  const afterFirstDoneAgain = applyExternalAiTaskEvent(
    retryRunning,
    event('run-a', 'done')
  )
  const task = afterFirstDoneAgain.get(event('run-b', 'running').taskKey)

  assert.equal(afterFirstDoneAgain, retryRunning)
  assert.equal(task.stage, 'running')
  assert.equal(task.runId, 'run-b')
  assert.equal(task.startedAt, 300)
})
