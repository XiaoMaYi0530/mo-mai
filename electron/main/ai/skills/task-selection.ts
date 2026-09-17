import type { AiTaskPayload } from '../shared-types'
import { normalizeSkillUsePolicy, type SkillUsePolicy } from '../../../shared/assistant-runtime'
import { getAllSkills, getEnabledSkills, getSkillById, refreshRegistry, resolveCanonicalSkillIds } from './registry'
import { pickSkillsFor } from './matcher'
import type { SkillSelection, SkillStageId } from './types'
import { isSkillAllowedAtStage, isSkillExplicitlyMentioned } from './selection-priority'
import { formatSkillGenreLabels, matchSkillGenre } from '../../../shared/skill-genres'

export type SkillPolicyDecision = {
  id: string
  name: string
  selected: boolean
  reason: string
}

export type ResolvedTaskSkills = {
  projectId: string
  skills: SkillSelection[]
  usedSkillIds: string[]
  policy: SkillUsePolicy
  decisions: SkillPolicyDecision[]
}

export async function resolveTaskSkills(task: AiTaskPayload): Promise<ResolvedTaskSkills> {
  const projectId = String(task.context.projectId ?? '').trim()
  await refreshRegistry(projectId || undefined).catch(() => {})

  const rawPolicy = normalizeSkillUsePolicy(task.context.skillPolicy)
  const policy = rawPolicy.mode === 'only'
    ? { ...rawPolicy, skillIds: resolveCanonicalSkillIds(projectId, rawPolicy.skillIds) }
    : rawPolicy
  if (policy.mode === 'off') {
    return { projectId, skills: [], usedSkillIds: [], policy, decisions: [] }
  }
  if (policy.mode === 'only' && policy.skillIds.length === 0) {
    throw new Error(`“仅使用”中的 Skill 已被删除、未导入或无法识别：${rawPolicy.skillIds.join('、') || '未选择 Skill'}。`)
  }
  const enabledOverrides = resolveSkillEnabledOverrides(task, projectId)
  const stageOverrides = resolveSkillStageOverrides(task, projectId)
  const skills = await pickSkillsFor(task, {
    enabledOverrides,
    stageOverrides,
    ...(policy.mode === 'only' ? { onlySkillIds: policy.skillIds } : {})
  })
  const decisions = buildSkillPolicyDecisions({
    task,
    projectId,
    rawPolicy,
    policy,
    selections: skills,
    enabledOverrides,
    stageOverrides
  })
  return {
    projectId,
    skills,
    usedSkillIds: skills.map((skill) => skill.id),
    policy,
    decisions
  }
}

function selectedReason(skill: NonNullable<ReturnType<typeof getSkillById>>, selection: SkillSelection, mode: SkillUsePolicy['mode'], task: AiTaskPayload): string {
  const genre = matchSkillGenre(skill.manifest.genres, String(task.context.projectGenre ?? ''))
  const parts = mode === 'only' ? ['对话明确指定'] : []
  if (mode === 'auto') {
    if (isSkillExplicitlyMentioned(skill, String(task.context.userPrompt ?? ''))) parts.push('用户在提示词中点名')
    else if ((selection.scoreBreakdown?.task ?? 0) > 0) parts.push('匹配当前任务')
    if ((selection.scoreBreakdown?.stage ?? 0) > 0) parts.push('匹配当前创作阶段')
  }
  if (genre === 'general') parts.push('通用题材')
  if (genre === 'match') parts.push(`匹配项目题材（${formatSkillGenreLabels(skill.manifest.genres)}）`)
  if (genre === 'mismatch') parts.push('用户点名，已覆盖题材限制')
  return parts.length > 0 ? parts.join('·') : '按触发词和优先级自动匹配'
}

function buildSkillPolicyDecisions(input: {
  task: AiTaskPayload
  projectId: string
  rawPolicy: SkillUsePolicy
  policy: SkillUsePolicy
  selections: SkillSelection[]
  enabledOverrides?: Map<string, boolean>
  stageOverrides?: Map<string, SkillStageId[]>
}): SkillPolicyDecision[] {
  const allSkills = getAllSkills(input.projectId || undefined)
  const selectedById = new Map(input.selections.map((selection) => [selection.id, selection]))
  const decisions: SkillPolicyDecision[] = input.selections.map((selection) => {
    const skill = getSkillById(selection.id, input.projectId || undefined)
    return {
      id: selection.id,
      name: selection.name,
      selected: true,
      reason: skill ? selectedReason(skill, selection, input.policy.mode, input.task) : '已选中'
    }
  })
  const stageId = String(input.task.context.stageId ?? '')
  const projectGenre = String(input.task.context.projectGenre ?? '')

  const explainSkip = (skill: typeof allSkills[number]): string => {
    if (skill.compatibility === 'external-only') return '仅供外部工具使用，当前助手不能执行'
    if ((input.enabledOverrides?.get(skill.id) ?? skill.enabled) !== true) return '当前项目未启用'
    if (!isSkillAllowedAtStage(skill, stageId, input.stageOverrides?.get(skill.id))) return '不适用当前创作阶段'
    if (matchSkillGenre(skill.manifest.genres, projectGenre) === 'mismatch') {
      return `题材不匹配（适用：${formatSkillGenreLabels(skill.manifest.genres)}）`
    }
    const selectedInGroup = allSkills.find((item) => (
      item.id !== skill.id
      && item.manifest.exclusiveGroup
      && item.manifest.exclusiveGroup === skill.manifest.exclusiveGroup
      && selectedById.has(item.id)
    ))
    if (selectedInGroup) return `同类规则已选择更匹配的“${selectedInGroup.name}”`
    return '本轮匹配度较低或超出 Skill 数量上限'
  }

  if (input.policy.mode === 'only') {
    for (const rawId of input.rawPolicy.skillIds) {
      const canonicalId = resolveCanonicalSkillIds(input.projectId, [rawId])[0]
      if (!canonicalId) {
        decisions.push({ id: rawId, name: rawId, selected: false, reason: 'Skill 已被删除、未导入或无法识别' })
        continue
      }
      if (selectedById.has(canonicalId) || decisions.some((item) => item.id === canonicalId)) continue
      const skill = getSkillById(canonicalId, input.projectId || undefined)
      if (skill) decisions.push({ id: skill.id, name: skill.name, selected: false, reason: explainSkip(skill) })
    }
    return decisions
  }

  // 自动模式只展示有解释价值的跳过项：题材不匹配、用户点名但未选中、或同组被替代。
  for (const skill of allSkills) {
    if (selectedById.has(skill.id)) continue
    const reason = explainSkip(skill)
    const useful = reason.startsWith('题材不匹配')
      || reason.startsWith('同类规则')
      || isSkillExplicitlyMentioned(skill, String(input.task.context.userPrompt ?? ''))
    if (useful) decisions.push({ id: skill.id, name: skill.name, selected: false, reason })
  }
  return decisions
}

export function resolveSkillStageOverrides(task: AiTaskPayload, projectId = ''): Map<string, SkillStageId[]> | undefined {
  if (!Array.isArray(task.context.projectSkills) || task.context.projectSkills.length === 0) return undefined
  const result = new Map<string, SkillStageId[]>()
  for (const rawSkill of task.context.projectSkills) {
    if (!rawSkill || typeof rawSkill !== 'object') continue
    const skill = rawSkill as { id?: unknown; stageIds?: unknown }
    const id = String(skill.id ?? '').trim()
    if (!id || !Array.isArray(skill.stageIds)) continue
    const canonicalId = resolveCanonicalSkillIds(projectId, [id])[0] ?? id
    result.set(canonicalId, skill.stageIds.filter((stage): stage is SkillStageId => (
      stage === 'reference' || stage === 'premise' || stage === 'setting' || stage === 'outline' || stage === 'draft'
    )))
  }
  return result.size ? result : undefined
}

export function resolveSkillEnabledOverrides(
  task: AiTaskPayload,
  projectId: string
): Map<string, boolean> | undefined {
  if (!Array.isArray(task.context.projectSkills)) {
    return undefined
  }

  const overrideById = new Map<string, boolean>()
  let hasExplicitEnabledState = false
  for (const rawSkill of task.context.projectSkills) {
    if (!rawSkill || typeof rawSkill !== 'object') {
      continue
    }
    const skill = rawSkill as { id?: unknown; enabled?: unknown }
    const id = String(skill.id ?? '').trim()
    if (!id) {
      continue
    }
    if (typeof skill.enabled === 'boolean') {
      hasExplicitEnabledState = true
      const canonicalId = resolveCanonicalSkillIds(projectId, [id])[0] ?? id
      overrideById.set(canonicalId, skill.enabled)
    } else {
      // 兼容旧调用方：它们只传"已启用 skill"列表，条目里没有 enabled 字段。
      const canonicalId = resolveCanonicalSkillIds(projectId, [id])[0] ?? id
      overrideById.set(canonicalId, true)
    }
  }

  const allSkills = getAllSkills(projectId || undefined)
  if (!allSkills.length) {
    return undefined
  }

  return new Map(allSkills.map((skill) => [
    skill.id,
    overrideById.get(skill.id) ?? (hasExplicitEnabledState ? false : skill.enabled)
  ]))
}

export function isSkillEnabledForTask(
  task: AiTaskPayload,
  skillId: string,
  projectId: string
): boolean {
  const policy = normalizeSkillUsePolicy(task.context.skillPolicy)
  if (policy.mode === 'off') return false
  const canonicalSkillId = resolveCanonicalSkillIds(projectId, [skillId])[0] ?? skillId
  const canonicalPolicyIds = policy.mode === 'only'
    ? resolveCanonicalSkillIds(projectId, policy.skillIds)
    : []
  if (policy.mode === 'only' && !canonicalPolicyIds.includes(canonicalSkillId)) return false
  const overrides = resolveSkillEnabledOverrides(task, projectId)
  if (overrides?.has(canonicalSkillId)) {
    return overrides.get(canonicalSkillId) === true
  }
  return getEnabledSkills(projectId || undefined).some((skill) => skill.id === canonicalSkillId)
}
