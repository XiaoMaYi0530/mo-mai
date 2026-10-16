import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parseSkillFrontmatter } from './frontmatter.ts'

test('解析带 loadWhen 的嵌套 references 对象列表', () => {
  const parsed = parseSkillFrontmatter(`---
name: 测试 Skill
description: 验证嵌套资料规则
manifest:
  category: analysis
  priority: 7
  genres: [general, xianxia]
  exclusiveGroup: reference-style
  references:
    - file: references/a.md
      loadWhen:
        task: reference-style-analysis
        chapterIndexMax: 3
    - file: references/b.md
---
# 正文`)

  assert.equal(parsed.manifest?.exclusiveGroup, 'reference-style')
  assert.deepEqual(parsed.manifest?.genres, ['general', 'xianxia'])
  assert.deepEqual(parsed.manifest?.references, [
    {
      file: 'references/a.md',
      loadWhen: { task: 'reference-style-analysis', chapterIndexMax: 3 }
    },
    { file: 'references/b.md' }
  ])
})

test('网游数值战斗 Skill 声明为可用的游戏正文技能', () => {
  const content = readFileSync(new URL('../../../../resources/skills/game-combat-writing/SKILL.md', import.meta.url), 'utf8')
  const parsed = parseSkillFrontmatter(content)
  assert.equal(parsed.name, '网游数值战斗写作')
  assert.equal(parsed.overrides.enabled, true)
  assert.deepEqual(parsed.manifest?.genres, ['game'])
  assert.ok(parsed.manifest?.stages?.includes('draft'))
  assert.ok(parsed.manifest?.tasks?.includes('chapter-first-draft'))
})
