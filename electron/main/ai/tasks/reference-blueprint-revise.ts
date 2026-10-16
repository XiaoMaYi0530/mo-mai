import type { AiTaskResult, ReferenceBlueprintRevisionResult } from '../shared-types'
import type { PromptBuildInput, TaskHandler } from './base'
import { extractJsonObject, jsonStringField } from './base'

const targets = new Set(['volume', 'node', 'chapter'])
const actions = new Set(['update', 'insert', 'delete'])

const handler: TaskHandler = {
  name: 'reference-blueprint-revise',
  outputType: 'json',
  useSkills: false,
  defaultCapabilities: ['settings', 'analysis', 'worldview', 'outline'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const history = Array.isArray(context.messages)
      ? context.messages.slice(-8).map((raw) => {
          const message = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
          return `${message.role === 'assistant' ? '助手' : '作者'}：${String(message.content ?? '').slice(0, 1_000)}`
        }).join('\n')
      : ''
    const blueprint = context.blueprint && typeof context.blueprint === 'object'
      ? JSON.stringify(context.blueprint)
      : '{}'

    return {
      system: `${capabilityPreamble.system}\n\n你是小说骨架编辑。根据作者的最新要求，只提出局部修改操作，不重新生成整份骨架。只输出 JSON。卷、节点和章节索引均从 0 开始；节点索引是对应卷内的顺序，章节索引是对应节点内的顺序。同一轮多条操作按返回顺序执行，后续索引应基于前面操作执行后的状态。`,
      user: `${capabilityPreamble.user}\n\n项目名称：${String(context.projectTitle ?? '')}\n原创方向：${String(context.projectPremise ?? '')}\n作者已选路线：${JSON.stringify(context.selectedConcept ?? null)}\n\n【当前骨架】\n${blueprint}\n\n【最近对话】\n${history}\n\n本轮要求：\n1. 以作者最后一条消息为当前修改指令，结合此前对话理解代词。只修改明确涉及的卷、剧情节点或章节建议，其余内容保持原样。\n2. update 只返回确实要改的字段；insert 必须包含 title、summary，节点和章节还需 conflict；delete 不需要文本字段。\n3. volume 只允许 update 卷名或 summary；node 和 chapter 允许 update、insert、delete。远期卷没有章节建议，不要修改其章节。\n4. 不改变原创方向或已选路线，不引入参考作品专名，不把调整扩散成整部小说重写。\n5. reply 用简短中文说明这次改哪几处；edits 为 1–8 条。若要求不明确，返回 edits 空数组并在 reply 中询问具体位置或方向。\n\n返回格式：{"reply":"修改说明或澄清问题","edits":[{"target":"node","action":"update","volumeIndex":0,"nodeIndex":1,"title":"仅修改时填写","conflict":"仅修改时填写","summary":"仅修改时填写"}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw)
    const edits = Array.isArray(parsed.edits) ? parsed.edits.slice(0, 8).flatMap((rawEdit) => {
      if (!rawEdit || typeof rawEdit !== 'object') return []
      const edit = rawEdit as Record<string, unknown>
      if (!targets.has(String(edit.target)) || !actions.has(String(edit.action))) return []
      const result: ReferenceBlueprintRevisionResult['edits'][number] = {
        target: edit.target as 'volume' | 'node' | 'chapter',
        action: edit.action as 'update' | 'insert' | 'delete',
        volumeIndex: Number(edit.volumeIndex)
      }
      if (edit.nodeIndex !== undefined) result.nodeIndex = Number(edit.nodeIndex)
      if (edit.chapterIndex !== undefined) result.chapterIndex = Number(edit.chapterIndex)
      if (edit.title !== undefined) result.title = jsonStringField(edit.title)
      if (edit.conflict !== undefined) result.conflict = jsonStringField(edit.conflict)
      if (edit.summary !== undefined) result.summary = jsonStringField(edit.summary)
      return [result]
    }) : []
    return { reply: jsonStringField(parsed.reply).trim(), edits } as ReferenceBlueprintRevisionResult
  },
  validate(result: AiTaskResult): boolean {
    const value = result as ReferenceBlueprintRevisionResult
    return Boolean(value.reply?.trim())
      && Array.isArray(value.edits)
      && value.edits.length <= 8
      && value.edits.every((edit) => {
        if (!Number.isInteger(edit.volumeIndex) || edit.volumeIndex < 0) return false
        if (edit.target !== 'volume' && (!Number.isInteger(edit.nodeIndex) || (edit.nodeIndex ?? -1) < 0)) return false
        if (edit.target === 'chapter' && (!Number.isInteger(edit.chapterIndex) || (edit.chapterIndex ?? -1) < 0)) return false
        if (edit.target === 'volume' && edit.action !== 'update') return false
        if (edit.action === 'update') {
          const fields = edit.target === 'volume' ? [edit.title, edit.summary] : [edit.title, edit.conflict, edit.summary]
          return fields.some((field) => typeof field === 'string' && Boolean(field.trim()))
        }
        if (edit.action === 'insert') return Boolean(edit.title?.trim() && edit.summary?.trim() && (edit.target === 'volume' || edit.conflict?.trim()))
        return true
      })
  },
  resolveMaxTokens(): number {
    return 2400
  }
}

export default handler
