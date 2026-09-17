import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSkillContentExcerpt } from './content-slice.ts'

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
