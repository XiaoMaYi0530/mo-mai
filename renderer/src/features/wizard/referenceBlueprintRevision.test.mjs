import assert from 'node:assert/strict'
import test from 'node:test'
import { applyBlueprintRevision } from './referenceBlueprintRevision.ts'

function blueprint() {
  return {
    blueprintSummary: '原故事', transformationNotes: [], worldviewEntries: [],
    outlineVolumes: [
      { title: '首卷', wordTarget: '100000', summary: '原目标' },
      { title: '第二卷', wordTarget: '100000', summary: '后续目标' }
    ],
    outlineItems: [
      { volumeIndex: 0, title: '节点一', conflict: '旧冲突', summary: '旧摘要', chapterPlan: [{ title: '第一章', conflict: '旧章冲突', summary: '旧章摘要' }] },
      { volumeIndex: 1, title: '远期节点', conflict: '远期冲突', summary: '远期摘要', chapterPlan: [] }
    ]
  }
}

test('AI 局部修改只更新指定卷和章节，原骨架保持不变', () => {
  const original = blueprint()
  const revised = applyBlueprintRevision(original, [
    { target: 'volume', action: 'update', volumeIndex: 1, summary: '主角主动夺回港口' },
    { target: 'chapter', action: 'update', volumeIndex: 0, nodeIndex: 0, chapterIndex: 0, summary: '新的章末钩子' }
  ])
  assert.equal(revised.outlineVolumes[1].summary, '主角主动夺回港口')
  assert.equal(revised.outlineItems[0].chapterPlan[0].summary, '新的章末钩子')
  assert.equal(revised.outlineItems[0].title, '节点一')
  assert.equal(original.outlineVolumes[1].summary, '后续目标')
  assert.equal(original.outlineItems[0].chapterPlan[0].summary, '旧章摘要')
})

test('AI 可增删节点和章节，错误位置不会部分修改原骨架', () => {
  const original = blueprint()
  const revised = applyBlueprintRevision(original, [
    { target: 'chapter', action: 'delete', volumeIndex: 0, nodeIndex: 0, chapterIndex: 0 },
    { target: 'chapter', action: 'insert', volumeIndex: 0, nodeIndex: 0, chapterIndex: 0, title: '新章', conflict: '新冲突', summary: '新摘要' },
    { target: 'node', action: 'insert', volumeIndex: 1, nodeIndex: 0, title: '新节点', conflict: '新冲突', summary: '新摘要' }
  ])
  assert.equal(revised.outlineItems[0].chapterPlan[0].title, '新章')
  assert.equal(revised.outlineItems[1].title, '新节点')
  assert.equal(revised.outlineItems[2].title, '远期节点')
  assert.throws(() => applyBlueprintRevision(original, [
    { target: 'volume', action: 'update', volumeIndex: 0, summary: '暂定' },
    { target: 'node', action: 'delete', volumeIndex: 3, nodeIndex: 0 }
  ]))
  assert.equal(original.outlineVolumes[0].summary, '原目标')
})
