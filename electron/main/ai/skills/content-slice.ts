import type { AiTaskPayload } from '../shared-types'
import type { SkillDefinition } from './types'

const STAGE_KEYWORDS: Record<string, string[]> = {
  reference: ['分析', '拆解', '风格', '题材', '市场', '样本'],
  premise: ['立意', '创意', '题材', '卖点', '读者', '商业'],
  setting: ['设定', '世界观', '人物', '势力', '关系', '规则'],
  outline: ['大纲', '结构', '节奏', '冲突', '爽点', '钩子', '高潮'],
  draft: ['正文', '章节', '叙事', '对话', '描写', '情绪', '润色', '文风']
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
}

function resolveKeywords(task: AiTaskPayload): string[] {
  const stageId = String(task.context.stageId ?? '').trim()
  const taskName = String(task.task ?? '')
  const prompt = String(task.context.userPrompt ?? '')
  const keywords = [...(STAGE_KEYWORDS[stageId] ?? [])]
  if (/polish|repair|analysis/.test(taskName) || /润色|修改|改写|审计|检查/.test(prompt)) {
    keywords.push('润色', '修改', '检查', '问题', '禁忌', '语言')
  }
  if (/outline/.test(taskName)) keywords.push('大纲', '结构', '节奏', '冲突')
  if (/character/.test(taskName)) keywords.push('人物', '角色', '动机', '弧光')
  if (/worldview/.test(taskName)) keywords.push('世界观', '设定', '势力', '规则')
  return [...new Set(keywords)]
}

type MarkdownSection = { heading: string; text: string; index: number; score: number }

function splitSections(body: string): { intro: string; sections: MarkdownSection[] } {
  const matches = [...body.matchAll(/^#{2,3}\s+(.+)$/gm)]
  if (!matches.length) return { intro: body, sections: [] }
  const intro = body.slice(0, matches[0].index).trim()
  const sections = matches.map((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? body.length
    return { heading: match[1].trim(), text: body.slice(start, end).trim(), index, score: 0 }
  })
  return { intro, sections }
}

/**
 * 按本轮任务抽取 SKILL.md 的相关章节，避免每次把整份长 Skill 塞入上下文。
 * 短 Skill 保持原文；长 Skill 保留简介、最相关章节和稳定的原始顺序。
 */
export function buildSkillContentExcerpt(
  skill: SkillDefinition,
  task: AiTaskPayload,
  maxChars = 5200
): string {
  const body = stripFrontmatter(skill.content).trim()
  if (body.length <= maxChars) return body

  const keywords = resolveKeywords(task)
  const { intro, sections } = splitSections(body)
  if (!sections.length) return `${body.slice(0, maxChars).trim()}\n\n[已按本轮任务截取 Skill 内容]`

  const scored = sections.map((section) => ({
    ...section,
    score: keywords.reduce((score, keyword) => (
      section.heading.includes(keyword) ? score + 3 : score
    ), /^(Purpose|When to Use|Checklist|用途|使用时机|检查清单)$/i.test(section.heading) ? 1 : 0)
  }))
  const picked: MarkdownSection[] = []
  let used = Math.min(intro.length, 900)
  for (const section of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (picked.length > 0 && section.score === 0) continue
    if (used + section.text.length > maxChars && picked.length > 0) continue
    picked.push(section)
    used += section.text.length
    if (used >= maxChars * 0.82) break
  }
  if (!picked.length) picked.push(scored[0])

  const excerpt = [intro.slice(0, 900).trim(), ...picked.sort((a, b) => a.index - b.index).map((item) => item.text)]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, maxChars)
    .trim()
  return `${excerpt}\n\n[已按本轮阶段只加载相关章节；需要细节时再按需读取 Skill 参考文件]`
}
