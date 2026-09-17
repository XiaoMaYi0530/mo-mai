import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildReferenceDeepAnalysisCoverage,
  buildReferenceDeepAnalysisPlan
} from './reference-deep-analysis.ts'

function document(title, dimension = '') {
  return {
    id: title,
    title,
    sourceType: title.includes('总纲') ? 'reference-summary' : 'reference-chunk',
    sourceLabel: '盘龙',
    content: '测试内容',
    summary: '测试内容',
    keywords: [],
    metadata: dimension ? { analysisDimension: dimension, sourceTitle: '盘龙' } : { sourceTitle: '盘龙' }
  }
}

test('深度拆书覆盖率兼容稳定维度标识与历史中文标题', () => {
  const coverage = buildReferenceDeepAnalysisCoverage([
    document('《盘龙》｜深度拆书总纲', 'overview'),
    document('《盘龙》｜主角：林雷'),
    document('《盘龙》｜主线：成长骨架'),
    document('《盘龙》｜第一章桥段拆解')
  ])

  assert.equal(coverage.completedCount, 4)
  assert.equal(coverage.creationReady, true)
  assert.equal(coverage.recommendedReady, true)
  assert.deepEqual(coverage.missingDimensionIds, ['supporting', 'worldbuilding', 'style'])
})

test('继续深度拆书只规划缺失维度，已有结果可断点续作', () => {
  const plan = buildReferenceDeepAnalysisPlan([
    document('总纲', 'overview'),
    document('主角', 'protagonist'),
    document('主线', 'mainline')
  ])

  assert.deepEqual(plan.targetDimensionIds, ['opening', 'supporting', 'worldbuilding', 'style'])
  assert.match(plan.promptSummary, /不要重新生成：整体总纲、主角画像、主线骨架/)
  assert.match(plan.promptSummary, /本轮只补充：黄金开篇、关键配角与反派、世界观与力量体系、风格指纹/)
})
