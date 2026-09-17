import assert from 'node:assert/strict'
import test from 'node:test'
import { buildDeepAnalysisSample } from './deepAnalysisSampling.ts'

function makeBook(count = 20) {
  return Array.from({ length: count }, (_, index) => {
    const marker = index === 15 ? '境界 法则 力量体系 宗门 世界设定 '.repeat(20) : ''
    return `第${index + 1}章 测试章节\n${marker}${`第${index + 1}章正文。`.repeat(500)}`
  }).join('\n\n')
}

test('深度拆书总纲会覆盖开头中段和后段', () => {
  const sample = buildDeepAnalysisSample(makeBook(), ['overview', 'mainline'], 20_000)
  assert.ok(sample.sampledPositions[0] <= 5)
  assert.ok(sample.sampledPositions.some((position) => position >= 40 && position <= 60))
  assert.ok(sample.sampledPositions.at(-1) >= 95)
  assert.match(sample.coverageLabel, /抽取/)
})

test('世界观维度会加入关键词命中的后段章节', () => {
  const sample = buildDeepAnalysisSample(makeBook(), ['worldbuilding'], 12_000)
  assert.match(sample.text, /第16章/)
  assert.match(sample.text, /力量体系/)
})
