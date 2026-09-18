import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { buildSkillContentExcerpt, DIRECT_SKILL_MAX_CHARS } from './content-slice.ts'

test('长 Skill 按大纲任务优先保留结构章节', () => {
  const filler = '无关说明'.repeat(500)
  const skill = {
    content: `---\nname: 测试\n---\n# 方法\n简介\n\n## 市场调研\n${filler}\n\n## 大纲结构与节奏\n必须保留的大纲规则\n\n## 附录\n${filler}`
  }
  const excerpt = buildSkillContentExcerpt(skill, {
    task: 'outline-batch',
    context: { stageId: 'outline', userPrompt: '设计大纲' }
  }, 1200)
  assert.match(excerpt, /必须保留的大纲规则/)
  assert.ok(excerpt.length <= 1300)
})

test('章节选区改写裁剪自然文风 Skill 时保留第一优先级的可读性规则', () => {
  const content = readFileSync(new URL('../../../../resources/skills/我吃西红柿笔锋/SKILL.md', import.meta.url), 'utf8')
  const excerpt = buildSkillContentExcerpt({ content }, {
    task: 'chapter-assistant',
    context: { stageId: 'draft', userPrompt: '改写以上选中内容' }
  }, 2400)
  assert.match(excerpt, /第一优先级：让读者一遍看懂/)
  assert.match(excerpt, /简练不能以省掉理解支点为代价/)
  assert.match(excerpt, /不能写成“一个兽爪也没有”/)
  assert.ok(excerpt.length <= 2500)
})

test('仅使用爽点 Skill 时不能只注入用途和清单，须保留正文操作规则', () => {
  const content = readFileSync(new URL('../../../../resources/skills/Distilled-Novel-Toolbox/novel-pleasure-points/SKILL.md', import.meta.url), 'utf8')
  const excerpt = buildSkillContentExcerpt({ content }, {
    task: 'chapter-assistant',
    context: { stageId: 'draft', userPrompt: '改写以上选中内容' }
  }, 2400)
  assert.match(excerpt, /扮猪吃虎/)
  assert.match(excerpt, /爽点结构模板/)
  assert.match(excerpt, /爽点疲劳管理/)
  assert.ok(excerpt.length <= 2500)
})

test('当前所有内置 Skill 在直接注入配额内均保留完整正文', () => {
  const root = new URL('../../../../resources/skills/', import.meta.url)
  const files = readdirSync(root, { recursive: true })
    .filter((file) => String(file).endsWith('SKILL.md'))
  assert.ok(files.length >= 14)
  for (const file of files) {
    const content = readFileSync(new URL(String(file), root), 'utf8')
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    const excerpt = buildSkillContentExcerpt({ content }, {
      task: 'chapter-assistant',
      context: { stageId: 'draft', userPrompt: '改写以上选中内容' }
    }, DIRECT_SKILL_MAX_CHARS)
    assert.equal(excerpt, body, `${file} 不应在直接注入时裁掉规则`)
  }
})
