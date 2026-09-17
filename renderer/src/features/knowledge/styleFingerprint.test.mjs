import assert from 'node:assert/strict'
import test from 'node:test'

import { buildStyleFingerprintSample, STYLE_FINGERPRINT_SAMPLE_CHAR_CAP } from './styleFingerprint.ts'

test('短文本保持原样', () => {
  assert.equal(buildStyleFingerprintSample('第一章\r\n正文'), '第一章\n正文')
})

test('长文本从全书均匀抽样并限制输入规模', () => {
  const source = Array.from({ length: 100_000 }, (_, index) => String(index % 10)).join('')
  const sample = buildStyleFingerprintSample(source)

  assert.match(sample, /全书位置约 0%/)
  assert.match(sample, /全书位置约 100%/)
  assert.equal((sample.match(/抽样 \d\/6/g) ?? []).length, 6)
  assert.ok(sample.length <= STYLE_FINGERPRINT_SAMPLE_CHAR_CAP + 500)
})
