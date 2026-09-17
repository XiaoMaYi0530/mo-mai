import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCodexContinuationPrompt,
  mergeCodexSessionUsageSnapshot
} from './codex-session-state.ts'

test('续接使用最新累计快照而不是重复相加', () => {
  const secondRound = mergeCodexSessionUsageSnapshot(
    { promptTokens: 38_720, completionTokens: 49, totalTokens: 38_769 },
    { promptTokens: 99_987, completionTokens: 96, totalTokens: 100_083 }
  )
  const usage = mergeCodexSessionUsageSnapshot(
    secondRound,
    { promptTokens: 184_260, completionTokens: 286, totalTokens: 184_546 }
  )
  assert.equal(usage?.promptTokens, 184_260)
  assert.equal(usage?.completionTokens, 286)
  assert.equal(usage?.totalTokens, 184_546)
  assert.notEqual(usage?.promptTokens, 322_967)
})

test('续接提示只包含新增工具结果，不接受也不重复原始长文本', () => {
  const prompt = buildCodexContinuationPrompt([{
    tool: 'knowledge_save_document',
    arguments: { title: '总纲' },
    content: '已保存。',
    isError: false
  }])
  assert.match(prompt, /已保存/)
  assert.doesNotMatch(prompt, /LONG_REFERENCE_SENTINEL/)
})
