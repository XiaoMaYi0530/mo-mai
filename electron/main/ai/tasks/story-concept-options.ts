import type { AiTaskResult, StoryConceptOptionsResult } from '../shared-types'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject, jsonStringField } from './base'

const RISK_VALUES = new Set(['low', 'medium', 'high'])

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => jsonStringField(item)).filter(Boolean))].slice(0, limit)
}

const handler: TaskHandler = {
  name: 'story-concept-options',
  outputType: 'json',
  defaultCapabilities: ['settings', 'inspiration', 'analysis', 'worldview', 'outline', 'project-skills'],
  maxSkills: 1,
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input
    const premise = String(context.projectPremise ?? '').trim()
    const referenceStructure = String(context.referenceStructure ?? '').trim().slice(0, 8_000)

    return {
      system: `${capabilityPreamble.system}

你是“网文创意孵化编辑”。你只负责在用户已经确定的原创方向内，提供可供选择的故事路线；此时不要生成分卷或章节大纲。只返回 JSON，不输出 Markdown。

优先级（从高到低）：
1. 用户原创方向中的明确事实；
2. 用户选择的题材与项目名称；
3. 参考作品中已经抽象出的叙事功能。

必须遵守：
1. 先提取 lockedFacts。凡用户已经明确的人名、身份、能力名称与机制、世界规则、关系、题材承诺，均视为不可改动的锁定事实。
2. 四条路线都必须保留全部 lockedFacts。不得擅自换主角、改能力、换世界、颠覆用户想写的核心故事。
3. 参考作品只可提供节奏、桥段功能、冲突升级方式等抽象经验；禁止复用专名、独有事件组合或逐章映射。
4. 四条路线必须在“因果发动机”上真正不同，至少拉开冲突来源、能力代价、关键关系、前期破局方法、长线升级机制中的三项；不能只换名称、职业或幕后黑手。
5. 不要用“世界是假的、系统是敌人、穿越是实验、主角其实是反派”等廉价反转代替创新，除非用户原创方向明确要求。
6. 每条路线应当能持续支撑长篇网文，并明确读者持续追读的承诺和同质化风险。
${skillsBlock}`,
      user: `${capabilityPreamble.user}

请为下列新小说生成恰好 4 条可选择的原创故事路线。

项目名称：${String(context.projectTitle ?? '')}
题材：${String(context.projectGenre ?? '')}

【用户原创方向（最高优先级，不得改写其中的明确事实）】
${premise}

【拆书结构研究（仅作抽象方法参考，可不采用）】
参考作品：${String(context.referenceTitle ?? '')}
${referenceStructure}

返回格式：
{
  "lockedFacts": ["从用户原创方向提取的锁定事实"],
  "options": [
    {
      "id": "concept-1",
      "title": "路线名称，不是小说书名",
      "logline": "一句话说明这条路线如何展开",
      "coreHook": "最有辨识度的核心钩子",
      "protagonistDrive": "主角欲望、困境与主动选择",
      "conflictEngine": "可持续升级的冲突来源和因果循环",
      "growthEngine": "能力、资源、地位或关系如何成长，以及代价",
      "longTermPromise": "读者为什么会持续追读",
      "differentiators": ["与其他路线及常见套路的实质差异，至少2条"],
      "referenceUsage": "只说明借鉴了何种抽象叙事功能；未采用则写未采用",
      "similarityRisk": "low"
    }
  ]
}

最后再次确认：四条路线都必须服从这段用户原创方向，不得生成另一部小说：
${premise}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const options = Array.isArray(parsed.options)
      ? parsed.options.slice(0, 4).map((value, index) => {
          const option = value && typeof value === 'object' ? value as Record<string, unknown> : {}
          const risk = jsonStringField(option.similarityRisk)
          return {
            id: jsonStringField(option.id) || `concept-${index + 1}`,
            title: jsonStringField(option.title),
            logline: jsonStringField(option.logline),
            coreHook: jsonStringField(option.coreHook),
            protagonistDrive: jsonStringField(option.protagonistDrive),
            conflictEngine: jsonStringField(option.conflictEngine),
            growthEngine: jsonStringField(option.growthEngine),
            longTermPromise: jsonStringField(option.longTermPromise),
            differentiators: stringList(option.differentiators, 6),
            referenceUsage: jsonStringField(option.referenceUsage),
            similarityRisk: RISK_VALUES.has(risk) ? risk as 'low' | 'medium' | 'high' : 'medium'
          }
        }).filter((option) => option.title && option.logline && option.coreHook)
      : []

    return {
      lockedFacts: stringList(parsed.lockedFacts, 12),
      options
    } as StoryConceptOptionsResult
  },
  validate(result: AiTaskResult): boolean {
    const value = result as StoryConceptOptionsResult
    return Array.isArray(value.lockedFacts)
      && value.lockedFacts.length >= 1
      && Array.isArray(value.options)
      && value.options.length === 4
      && value.options.every((option) => Boolean(
        option.title
        && option.logline
        && option.coreHook
        && option.protagonistDrive
        && option.conflictEngine
        && option.growthEngine
        && option.longTermPromise
        && option.differentiators.length >= 2
      ))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const value = result as Partial<StoryConceptOptionsResult>
    const errors: string[] = []
    if (!value.lockedFacts?.length) errors.push('lockedFacts 不能为空，必须从用户原创方向提取不可改动事实')
    if (value.options?.length !== 4) errors.push('options 必须恰好包含 4 条路线')
    if (value.options?.some((option) => (option.differentiators?.length ?? 0) < 2)) {
      errors.push('每条路线的 differentiators 至少包含 2 项')
    }
    return errors
  },
  resolveMaxTokens(): number {
    return 6000
  }
}

export default handler
