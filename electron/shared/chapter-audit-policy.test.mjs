import assert from 'node:assert/strict'
import test from 'node:test'

import { buildChapterWordCountIssue, buildLocalChapterAudit } from './chapter-audit-policy.ts'

test('章节字数不足目标九成时返回关键问题', () => {
  const issue = buildChapterWordCountIssue(3000, 2600)
  assert.equal(issue?.category, 'word-count')
  assert.match(issue?.hint ?? '', /补足约 100 字/)
})

test('章节超过目标字数不属于审计问题', () => {
  assert.equal(buildChapterWordCountIssue(3000, 6000), null)
})

test('最终稿复验以当前正文重新测量字数和重复段落', () => {
  const draft = '林岚走进钟楼。'.repeat(20)
  const finalText = `${draft}\n\n${draft}`
  const result = buildLocalChapterAudit(finalText, 400)
  assert.equal(result.wordCount, finalText.length)
  assert.equal(result.pass, false)
  assert.deepEqual(result.issues.map((issue) => issue.category), ['word-count', 'duplicate-paragraph'])
})

test('疑似模板化表达只提示，不阻止保存或改动正文', () => {
  const text = '他不知道的是，旧信已经到了城门。'
  const result = buildLocalChapterAudit(text, 10)
  assert.equal(result.pass, true)
  assert.deepEqual(result.issues.map((issue) => issue.category), ['prose-style'])
  assert.equal(text, '他不知道的是，旧信已经到了城门。')
})
