import assert from 'node:assert/strict'
import test from 'node:test'

import { WorkspaceRevisionGuard } from './workspace-revision.ts'

test('AI 写回后拒绝旧窗口的全量快照，避免已写回章节和大纲被抹掉', () => {
  const guard = new WorkspaceRevisionGuard()
  const oldWindow = guard.stamp({ workspaces: { project: { outlineItems: [] } } })
  assert.equal(guard.accepts(oldWindow), true)

  const committed = guard.advance({ workspaces: { project: { outlineItems: [{ id: 'new-outline' }] } } })
  assert.equal(committed.workspaceRevision, 1)
  assert.equal(guard.accepts(oldWindow), false)
  assert.equal(guard.accepts(committed), true)
})

test('批量暂存写回进行中拒绝并发的全量保存', () => {
  const guard = new WorkspaceRevisionGuard()
  const snapshot = guard.stamp({ workspaces: {} })
  guard.beginMutation()
  assert.equal(guard.accepts(snapshot), false)
  guard.endMutation()
  assert.equal(guard.accepts(snapshot), true)
})
