import type { AiTaskResult, PremiseDialogResult } from '../shared-types.ts'
import type { PromptBuildInput, TaskHandler } from './base.ts'
import { extractJsonObject, jsonStringField } from './base.ts'

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => jsonStringField(item)).filter(Boolean))].slice(0, limit)
}

const handler: TaskHandler = {
  name: 'premise-dialog',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'inspiration', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const messages = Array.isArray(context.messages)
      ? context.messages.slice(-10).map((message) => {
          const item = message && typeof message === 'object' ? message as Record<string, unknown> : {}
          const role = item.role === 'assistant' ? '策划编辑' : '作者'
          return `${role}：${String(item.content ?? '').trim().slice(0, 1_200)}`
        }).filter((line) => !line.endsWith('：')).join('\n')
      : ''
    const forceDraft = context.forceDraft === true

    return {
      system: `${capabilityPreamble.system}\n\n你是耐心、具体的小说创意策划编辑。你正在新建作品向导里和作者短对话，目标是把模糊想法逐步收束成可直接保存的小说简介。你不是替作者擅自决定一切，也不生成分卷或章节大纲。只返回 JSON，不输出 Markdown。`,
      user: `${capabilityPreamble.user}\n\n作品名称：${String(context.projectTitle ?? '') || '暂未确定'}
作品题材：${String(context.projectGenre ?? '')}
目标篇幅：${String(context.projectNovelLengthLabel ?? '')}
当前简介（可能为空）：${String(context.currentPremise ?? '').trim() || '暂无'}
对话中上一版草稿（可能为空）：${String(context.dialogDraft ?? '').trim() || '暂无'}

【最近对话】
${messages || '作者还没有提供具体想法。'}

本轮要求：
1. 先尊重并复述作者已经明确的事实，不得擅自改变人物、能力、关系或故事方向。
2. 信息不足时，不要泛泛追问“你想写什么”；给出 2–3 个贴合当前题材的具体可选方向，再只问 1 个最关键的问题，降低作者回答门槛。
3. 信息较完整时，指出当前故事最有力的钩子，并生成一版 180–500 字的简介。已有对话草稿时应结合作者最新回答修订，而不是另写一个无关版本。简介应包含：主角处境、触发事件、主动目标、持续阻力或代价、未决悬念。
4. 不使用“这是一个关于”“命运的齿轮”等套话，不堆形容词，不凭空创造一串专有名词。
5. reply 是给作者看的简短对话回复；questions 返回最多 3 条作者可直接点击发送的第一人称回答或方向选项，不要写成向作者提问的疑问句。
6. ready 表示目前是否已有可采用的简介；ready 为 true 时 premise 必须非空，ready 为 false 时 premise 可以为空。
7. ${forceDraft ? '作者明确要求按现有信息先生成一版：请使用稳妥中性表达补足连接，不新增关键专名，并令 ready=true。' : '如果关键因果仍不明确，优先继续引导，不要急着替作者拍板。'}

返回格式：{"reply":"给作者的回复","questions":["具体方向或追问"],"premise":"可采用的简介，未成熟时为空字符串","ready":false}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const premise = jsonStringField(parsed.premise).trim()
    return {
      reply: jsonStringField(parsed.reply).trim(),
      questions: stringList(parsed.questions, 3),
      premise,
      ready: parsed.ready === true && premise.length > 0
    } as PremiseDialogResult
  },
  validate(result: AiTaskResult): boolean {
    const value = result as PremiseDialogResult
    return Boolean(value.reply?.trim())
      && Array.isArray(value.questions)
      && value.questions.length <= 3
      && typeof value.premise === 'string'
      && value.premise.length <= 800
      && typeof value.ready === 'boolean'
      && (!value.ready || Boolean(value.premise.trim()))
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const value = result as Partial<PremiseDialogResult>
    const errors: string[] = []
    if (!value.reply?.trim()) errors.push('reply 不能为空。')
    if (!Array.isArray(value.questions) || value.questions.length > 3) errors.push('questions 必须是最多 3 条的数组。')
    if (typeof value.premise !== 'string' || value.premise.length > 800) errors.push('premise 必须是 800 字以内的字符串。')
    if (value.ready === true && !value.premise?.trim()) errors.push('ready 为 true 时 premise 不能为空。')
    return errors
  },
  resolveMaxTokens(): number {
    return 1600
  }
}

export default handler
