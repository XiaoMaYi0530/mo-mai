import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'
import { formatProjectSkillsContext } from '../prompts/shared'
import { PROSE_CLARITY_RULES } from '../prompts/prose-clarity'

function stripHumanizePreamble(text: string): string {
  const normalized = normalizeAssistantText(text).content.trim()
  const separator = normalized.match(/(?:^|\n)\s*(?:---+|\*\*\*+|===+)\s*(?:\n|$)/)
  if (separator?.index !== undefined && separator.index < 1800) {
    return normalized.slice(separator.index + separator[0].length).trim()
  }
  return normalized
    .replace(/^(?:I am Claude,?\s+made by Anthropic\.?|我是\s*Claude[^\n]*|我理解了[^\n]*|以下是[^\n]*|润色后的正文[:：]?|正文[:：]?)\s*/i, '')
    .trim()
}

const handler: TaskHandler = {
  name: 'chapter-humanize',
  outputType: 'text',
  maxSkills: 6,
  defaultCapabilities: ['settings', 'chapters', 'writing-style', 'project-skills'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input
    const projectSkillsBlock = formatProjectSkillsContext(context.projectSkills)
    const baseSkillsSection = projectSkillsBlock || skillsBlock
      ? `\n\n== 本步骤启用的提示词 Skills ==\n${projectSkillsBlock || ''}${projectSkillsBlock && skillsBlock ? '\n\n== 自动命中的补充 Skills ==\n' : ''}${skillsBlock || ''}`
      : ''
    const skillsSection = `${baseSkillsSection}${context.gameProgressionBlock ? `\n\n== 游戏数值账本（事实约束，不得改写数值） ==\n${String(context.gameProgressionBlock)}` : ''}`

    return {
      system: `${capabilityPreamble.system}\n\n你是中文小说整章去 AI 味润色编辑。你只改表达质感，不改剧情设计。输出必须是可直接写入章节编辑器的正文。\n\n${PROSE_CLARITY_RULES}`,
      user: `${capabilityPreamble.user}\n\n请对以下章节正文做去 AI 味润色。\n\n项目标题：${String(context.projectTitle ?? '')}\n项目题材：${String(context.projectGenre ?? '')}\n当前风格：${String(context.writingStyleLabel ?? '未指定')}\n风格要求：${String(context.writingStylePrompt ?? '暂无')}\n章节标题：${String(context.chapterTitle ?? '')}\n章节摘要：${String(context.chapterSummary ?? '')}${skillsSection}${context.referenceStyleContext ? `\n\n== 项目绑定风格指纹（只约束表达，不照搬内容） ==\n${String(context.referenceStyleContext)}` : ''}\n\n用户补充要求：\n${String(context.userPrompt ?? '') || '无'}\n\n硬约束：\n1. 不改变剧情事实、人物关系、设定、时间线和因果链。\n2. 不新增事件、角色、设定、物品、地点；不删除关键情节。\n3. 人名、地名、组织名、功法名、物件名等专有名词一字不改。\n4. 字数控制在原文 ±10%，只做表达层面的润色。\n5. 降低 AI 味：减少机械总结、模板句、同义反复、连续相同句式；已自然通顺的句子可以原样保留。\n6. 重点修正含混指代、临时造词、动作对象不明和判断缺乏依据；必要时补足几个字，不因追求潜台词而藏掉必需信息。\n7. 情绪可由动作、感官、物件或对白承载，直接说清楚更自然时也可直说，不机械添加小动作。\n8. 删除任何身份声明、解释、markdown 标记、分隔线和标题前缀。\n9. 只输出润色后的完整正文，不要解释，不要列修改点。\n\n待润色正文：\n${String(context.sourceText ?? '')}`
    }
  },
  normalize(raw: string): AiTaskResult {
    return { content: stripHumanizePreamble(raw) } as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    return Boolean((result as ChapterAssistantResult).content?.trim())
  },
  resolveMaxTokens(input: PromptBuildInput): number {
    const sourceLength = String(input.context.sourceText ?? '').length
    return Math.max(5000, Math.ceil(sourceLength * 1.5))
  }
}

export default handler
