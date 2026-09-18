import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { formatMountedSkills, formatProjectSkillsContext } from './shared.ts'

test('专用写作路径不再对已选 Skill 做第二次硬截断', () => {
  const content = readFileSync(new URL('../../../../resources/skills/Distilled-Novel-Toolbox/novel-pleasure-points/SKILL.md', import.meta.url), 'utf8')
  const block = formatMountedSkills([{ id: 'novel-pleasure-points', name: '爽点设计', content, referenceContents: [], score: 100 }])
  assert.match(block, /爽点疲劳管理/)
  assert.match(block, /爽点强度递进，不原地踏步/)
})

test('项目级 Skill 超过上下文配额时仍保留最高优先级规则', () => {
  const block = formatProjectSkillsContext([{
    id: 'long-skill',
    name: '长 Skill',
    content: `# 方法\n${'背景介绍。'.repeat(550)}\n\n## 必须遵守\n不可省略的写作规则。`
  }])
  assert.match(block, /不可省略的写作规则/)
})

test('专用写作路径保留所有已选 Skill，不暗中只取前四个', () => {
  const skills = Array.from({ length: 5 }, (_, index) => ({
    id: `skill-${index + 1}`,
    name: `Skill ${index + 1}`,
    content: `第 ${index + 1} 项规则`,
    referenceContents: [],
    score: 100
  }))
  assert.match(formatMountedSkills(skills), /第 5 项规则/)
})
