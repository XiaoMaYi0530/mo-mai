import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { PROSE_CLARITY_RULES } from '../prompts/prose-clarity.ts'

const readSource = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')

test('初稿、章节助手和整章润色共用一次读懂的可读性底线', () => {
  for (const file of ['chapter-first-draft.ts', 'chapter-assistant.ts', 'chapter-humanize.ts']) {
    const source = readSource(file)
    assert.match(source, /import \{ PROSE_CLARITY_RULES \} from '\.\.\/prompts\/prose-clarity'/, file)
    assert.match(source, /\$\{PROSE_CLARITY_RULES\}/, file)
  }
  for (const essential of ['动作对象', '代词', '战斗口令', '线索', '环境修辞']) {
    assert.ok(PROSE_CLARITY_RULES.includes(essential), essential)
  }
})

test('初稿不再强制每句对白藏意图、按固定字数反转或给所有情绪配动作', () => {
  const source = readSource('chapter-first-draft.ts')
  assert.doesNotMatch(source, /每句有效对白至少同时服务两个目的/)
  assert.doesNotMatch(source, /每 400-600 字出现一次压力升级/)
  assert.doesNotMatch(source, /抽象情绪必须外化/)
  assert.doesNotMatch(source, /每个场景有明确的情绪起点和终点，且两者必须不同/)
  assert.doesNotMatch(source, /必须有至少一个非视觉感官细节/)
  assert.match(source, /读者此刻必须知道的对象或规则时可以直说/)
})
