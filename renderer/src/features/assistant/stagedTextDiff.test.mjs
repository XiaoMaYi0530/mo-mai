import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStagedTextDiff } from './stagedTextDiff.ts'

test('整章重新分段但文字相同时只报告排版变化', () => {
  const result = buildStagedTextDiff(
    '<p>第一句相同。第二句相同。</p>',
    '第一句相同。\n\n第二句相同。'
  )

  assert.equal(result.contentChanged, false)
  assert.equal(result.formattingChanged, true)
  assert.deepEqual(result.added, [])
  assert.deepEqual(result.removed, [])
})

test('整章润色按句子保留相同内容，并只标记句内变化字符', () => {
  const result = buildStagedTextDiff(
    '<p>第一句相同。</p><p>第二句只改一个词。</p><p>第三句相同。</p>',
    '第一句相同。\n\n第二句只改一个字。\n\n第三句相同。'
  )

  assert.equal(result.contentChanged, true)
  assert.deepEqual(result.removed, ['第二句只改一个词。'])
  assert.deepEqual(result.added, ['第二句只改一个字。'])
  assert.equal(result.rows.filter((row) => row.type === 'context').length, 2)
  assert.ok(result.rows.find((row) => row.type === 'del')?.segments.some((segment) => segment.type === 'del' && segment.text === '词'))
  assert.ok(result.rows.find((row) => row.type === 'add')?.segments.some((segment) => segment.type === 'add' && segment.text === '字'))
})

test('非章节变更继续按原有逐行结构对齐', () => {
  const result = buildStagedTextDiff(
    '姓名：陆烬\n身份：学员\n等级：三级',
    '姓名：陆烬\n身份：导师\n等级：三级',
    { mode: 'line' }
  )

  assert.deepEqual(result.removed, ['身份：学员'])
  assert.deepEqual(result.added, ['身份：导师'])
  assert.equal(result.formattingChanged, false)
  assert.equal(result.rows.filter((row) => row.type === 'context').length, 2)
})
