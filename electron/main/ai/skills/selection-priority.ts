type CandidateSkill = {
  id: string
  name: string
  manifest: { required?: boolean; exclusiveGroup?: string; stages?: string[] }
}

export type PrioritizedSkillCandidate = {
  skill: CandidateSkill
  breakdown: { total: number }
}

function normalizeMention(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

/** 用户在自然语言中明确写出 Skill ID 或显示名称时，视为主动点名。 */
export function isSkillExplicitlyMentioned(skill: CandidateSkill, userPrompt: string): boolean {
  const prompt = normalizeMention(userPrompt)
  if (!prompt) return false
  return [skill.id, skill.name]
    .map(normalizeMention)
    .filter((value) => value.length >= 2)
    .some((value) => prompt.includes(value))
}

/**
 * 自动模式候选选择：required 与用户点名项优先保留，剩余名额再按评分填充。
 * 点名项不受普通候选数量上限挤压；若点名/必选项本身超过上限，则全部保留。
 */
export function selectSkillCandidates<T extends PrioritizedSkillCandidate>(
  entries: T[],
  userPrompt: string,
  maxSkills: number,
  compare: (a: T, b: T) => number
): T[] {
  const decorated = entries.map((entry) => ({
    entry,
    pinned: entry.skill.manifest.required === true || isSkillExplicitlyMentioned(entry.skill, userPrompt)
  }))
  const eligible = decorated.filter(({ entry, pinned }) => entry.breakdown.total > 0 || pinned)
  const claimedGroups = new Set<string>()
  const deduplicateExclusiveGroups = (candidates: T[]): T[] => candidates.filter((entry) => {
    const group = entry.skill.manifest.exclusiveGroup?.trim()
    if (!group) return true
    if (claimedGroups.has(group)) return false
    claimedGroups.add(group)
    return true
  })
  const pinned = deduplicateExclusiveGroups(
    eligible.filter((item) => item.pinned).map((item) => item.entry).sort(compare)
  )
  const optional = deduplicateExclusiveGroups(
    eligible.filter((item) => !item.pinned).map((item) => item.entry).sort(compare)
  )
  return [...pinned, ...optional.slice(0, Math.max(0, maxSkills - pinned.length))]
}

/** 空阶段列表表示不限阶段；项目覆盖优先于 Skill 自带阶段。 */
export function isSkillAllowedAtStage(
  skill: CandidateSkill,
  stageId: string,
  stageOverride?: string[]
): boolean {
  if (!stageId) return true
  const stages = stageOverride ?? skill.manifest.stages ?? []
  return stages.length === 0 || stages.includes(stageId)
}

/** 自动模式按创作阶段控制注入数量，正文最克制，防止规则互相稀释。 */
export function resolveAutoSkillLimit(stageId: string): number {
  if (stageId === 'reference') return 1
  if (stageId === 'premise' || stageId === 'setting' || stageId === 'draft') return 2
  if (stageId === 'outline') return 3
  return 3
}
