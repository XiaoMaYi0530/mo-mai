import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  assertReferenceTextUsable,
  decodeReferenceNovelBuffer
} from './referenceAnalysis.ts'

test('GB18030 小说原文会被正确解码，而不是保存为替换字符', () => {
  // “盘龙中文”的 GB18030/GBK 字节。
  const bytes = Buffer.from([0xc5, 0xcc, 0xc1, 0xfa, 0xd6, 0xd0, 0xce, 0xc4])
  const decoded = decodeReferenceNovelBuffer(bytes)

  assert.equal(decoded.encoding, 'GB18030')
  assert.equal(decoded.text, '盘龙中文')
  assert.equal(decoded.text.includes('�'), false)
})

test('风格指纹提取前会拒绝明显乱码的原文', () => {
  const broken = `${'�'.repeat(740)}${'正常中文'.repeat(60)}`

  assert.throws(
    () => assertReferenceTextUsable(broken),
    /原文编码损坏/
  )
})

test('导入分析和后续指纹读取共用同一套乱码拦截', () => {
  const source = readFileSync(new URL('./referenceAnalysis.ts', import.meta.url), 'utf8')
  assert.match(source, /const text = await readNovelText\(filePath, fileType\)\s+assertReferenceTextUsable\(text\)/)
})

test('单本和批量导入都保存统一解码后的 sourceText', () => {
  const source = readFileSync(new URL('./register-main-ipc.ts', import.meta.url), 'utf8')
  assert.equal((source.match(/localContext\.sourceText/g) ?? []).length >= 4, true)
  assert.doesNotMatch(source, /const rawNovelText = await readFile\([^\n]+, 'utf-8'\)/)
})
