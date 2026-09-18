import type { SkillDefinition } from './types'

/** 从用户导入 Skill 正式迁入安装包；同 ID 的本机旧副本保留在磁盘作回退，但不再遮蔽内置版。 */
export const PROMOTED_BUILTIN_SKILL_IDS = new Set(['我吃西红柿笔锋', '我吃西红柿架构'])

export function mergeScannedSkillSources(
  builtinSkills: SkillDefinition[],
  importedSkills: SkillDefinition[]
): SkillDefinition[] {
  const merged = new Map(builtinSkills.map((skill) => [skill.id, skill]))
  for (const skill of importedSkills) {
    if (PROMOTED_BUILTIN_SKILL_IDS.has(skill.id) && merged.has(skill.id)) continue
    merged.set(skill.id, skill)
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}
