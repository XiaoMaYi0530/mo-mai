import type { SurfaceDefinition } from '@shared/assistant-runtime'
import type { SkillStageId } from '../skills'
import type { AssistantRuntimePlan } from './planner'

/** 根据本轮显式意图解析 Skill 阶段。后续会在此加入组合与历史阶段继承。 */
export function resolveSkillStage(
  runtimePlan: Pick<AssistantRuntimePlan, 'intent'>,
  surface: SurfaceDefinition,
  userMessage: string,
  skillPresetId?: string,
  previousStageId?: SkillStageId
): SkillStageId | undefined {
  const text = userMessage.replace(/\s+/g, '')

  // 本轮明确动作始终优先。尤其“根据大纲开始写正文”同时含两个领域词，
  // 应按动作目标切到正文，而不是被前置的“大纲”关键词截走。
  const explicitlyWritesDraft =
    /(?:写|创作|生成|开始|继续|续写|润色|改写|扩写|重写|优化).*?(?:正文|第?[零一二两三四五六七八九十百\d]+章|章节|初稿)/.test(text) ||
    /(?:正文|第?[零一二两三四五六七八九十百\d]+章|章节|初稿).*?(?:写|创作|生成|续写|润色|改写|扩写|重写|优化)/.test(text)
  if (explicitlyWritesDraft) return 'draft'
  if (/(拆书|参考书|对标|风格分析|参考分析)/.test(text)) return 'reference'
  if (/(大纲|剧情节点|分卷|卷纲|第[零一二两三四五六七八九十百\d]+卷)/.test(text)) return 'outline'
  if (surface.scope === 'chapter' || surface.scope === 'selection') return 'draft'
  if (/(润色|改写|续写|扩写|重写|初稿)/.test(text)) return 'draft'
  if (/(简介|立意|卖点|题材|开书|项目初始化)/.test(text)) return 'premise'
  if (/(世界观|设定|人设|人物|角色|组织|势力|关系|伏笔|线索)/.test(text)) return 'setting'

  // 短追问没有明确任务词时，先继承用户当前主动选择的快捷组合。
  const presetStage: Partial<Record<string, SkillStageId>> = {
    draft: 'draft',
    polish: 'draft',
    outline: 'outline',
    setting: 'setting'
  }
  if (skillPresetId && presetStage[skillPresetId]) return presetStage[skillPresetId]

  // 没有快捷组合语义时，再延续同一会话上一轮成功执行的阶段。
  if (previousStageId) return previousStageId

  if (runtimePlan.intent === 'entity-edit' || runtimePlan.intent === 'ingest' || runtimePlan.intent === 'correct') {
    return 'setting'
  }
  return undefined
}
