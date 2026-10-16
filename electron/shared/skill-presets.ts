import type { SkillUsePolicy } from './assistant-runtime'
import { matchSkillGenre, type SkillGenreId } from './skill-genres.ts'

export type SkillPresetId = 'draft' | 'polish' | 'outline' | 'setting' | 'audit'

/** 当前项目对内置预设的覆盖；缺少某个 key 表示继续继承内置组合。 */
export type SkillPresetBindings = Partial<Record<SkillPresetId, string[]>>

export type SkillPresetCandidate = {
  id: string
  name: string
  description?: string
  genreIds?: SkillGenreId[]
}

type SkillPresetRole = {
  label: string
  aliases: string[]
  fallbackAliases?: string[]
  /** 仅在项目题材明确匹配时启用此可选角色。 */
  genreIds?: SkillGenreId[]
}

export type SkillPresetDefinition = {
  id: SkillPresetId
  name: string
  description: string
  roles: SkillPresetRole[]
}

export type ResolvedSkillPreset = {
  preset: SkillPresetDefinition
  policy: SkillUsePolicy
  skills: SkillPresetCandidate[]
  missingRoles: string[]
  customized: boolean
}

/** 面向创作动作的精简预设，避免用户记忆 Skill ID 或手工反复勾选。 */
export const SKILL_PRESETS: SkillPresetDefinition[] = [
  {
    id: 'draft',
    name: '正文创作',
    description: '先按项目题材把握长篇结构与章节节奏，再用自然、人物驱动的笔法完成正文。',
    roles: [
      {
        label: '题材适配架构',
        aliases: ['我吃西红柿架构', 'chinese-xianxia-serial-writer', '网文架构'],
        fallbackAliases: ['novel-pacing', '章节节奏与结构']
      },
      {
        label: '人物驱动自然文风',
        aliases: ['我吃西红柿笔锋', 'fiction-human-texture', '写作润色'],
        fallbackAliases: ['novel-language-style', '语言与文风']
      },
      {
        label: '网游数值战斗',
        aliases: ['game-combat-writing', '网游数值战斗写作'],
        genreIds: ['game']
      }
    ]
  },
  {
    id: 'polish',
    name: '正文润色',
    description: '只处理人物质感、语言节奏和自然表达，不擅自改动剧情结构。',
    roles: [
      {
        label: '人物驱动自然文风',
        aliases: ['我吃西红柿笔锋', 'fiction-human-texture', '写作润色'],
        fallbackAliases: ['novel-language-style', '语言与文风']
      }
    ]
  },
  {
    id: 'outline',
    name: '大纲设计',
    description: '组合长篇架构、章节节奏与爽点密度，适合卷纲和章节大纲。',
    roles: [
      {
        label: '题材适配架构',
        aliases: ['我吃西红柿架构', 'chinese-xianxia-serial-writer', '网文架构'],
        fallbackAliases: ['novel-pacing', '章节节奏与结构']
      },
      { label: '章节节奏与结构', aliases: ['novel-pacing', '章节节奏与结构'] },
      { label: '爽点设计', aliases: ['novel-pleasure-points', '爽点设计'] }
    ]
  },
  {
    id: 'setting',
    name: '设定建设',
    description: '集中构建世界规则、势力体系、人物功能与关系弧光。',
    roles: [
      { label: '世界观与设定', aliases: ['novel-worldbuilding', '世界观与设定'] },
      { label: '人物与群像设计', aliases: ['novel-character-design', '人物与群像设计'] }
    ]
  },
  {
    id: 'audit',
    name: '审计检查',
    description: '从长篇结构和平台合规两个维度检查问题，不直接代写正文。',
    roles: [
      {
        label: '题材适配架构',
        aliases: ['我吃西红柿架构', 'chinese-xianxia-serial-writer', '网文架构'],
        fallbackAliases: ['novel-pacing', '章节节奏与结构']
      },
      { label: '内容合规检查', aliases: ['novel-compliance', '内容合规检查'] }
    ]
  }
]

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN').replace(/\s+/g, '')
}

const SKILL_PRESET_IDS = new Set<SkillPresetId>(SKILL_PRESETS.map((preset) => preset.id))

/** 清洗来自旧项目、归档或 IPC 的项目级预设绑定。空数组是有效覆盖。 */
export function normalizeSkillPresetBindings(value: unknown): SkillPresetBindings {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const result: SkillPresetBindings = {}
  for (const [key, skillIds] of Object.entries(raw)) {
    if (!SKILL_PRESET_IDS.has(key as SkillPresetId) || !Array.isArray(skillIds)) continue
    result[key as SkillPresetId] = [...new Set(skillIds
      .map((id) => String(id ?? '').trim())
      .filter(Boolean))]
  }
  return result
}

export function updateSkillPresetBinding(
  bindings: SkillPresetBindings | undefined,
  presetId: SkillPresetId,
  skillIds: string[]
): SkillPresetBindings {
  return {
    ...normalizeSkillPresetBindings(bindings),
    [presetId]: [...new Set(skillIds.map((id) => id.trim()).filter(Boolean))]
  }
}

export function resetSkillPresetBinding(
  bindings: SkillPresetBindings | undefined,
  presetId: SkillPresetId
): SkillPresetBindings {
  const next = normalizeSkillPresetBindings(bindings)
  delete next[presetId]
  return next
}

/** 将已绑定项按绑定顺序置顶，其余项保持扫描时的稳定顺序。 */
export function orderSkillsByPresetBinding<T extends SkillPresetCandidate>(
  skills: T[],
  boundSkillIds: string[]
): T[] {
  const byId = new Map(skills.map((skill) => [skill.id, skill]))
  const ordered: T[] = []
  const used = new Set<string>()
  for (const id of boundSkillIds) {
    const skill = byId.get(id)
    if (!skill || used.has(id)) continue
    ordered.push(skill)
    used.add(id)
  }
  for (const skill of skills) {
    if (used.has(skill.id)) continue
    ordered.push(skill)
  }
  return ordered
}

/** 将预设的功能角色解析为当前安装环境中的真实 Skill。 */
export function resolveSkillPreset(
  presetId: SkillPresetId,
  availableSkills: SkillPresetCandidate[],
  projectGenre = '',
  bindings?: SkillPresetBindings
): ResolvedSkillPreset {
  const preset = SKILL_PRESETS.find((item) => item.id === presetId) ?? SKILL_PRESETS[0]
  const normalizedBindings = normalizeSkillPresetBindings(bindings)
  if (Object.prototype.hasOwnProperty.call(normalizedBindings, preset.id)) {
    const requestedIds = normalizedBindings[preset.id] ?? []
    const availableById = new Map(availableSkills.map((skill) => [skill.id, skill]))
    const skills = requestedIds
      .map((id) => availableById.get(id))
      .filter((skill): skill is SkillPresetCandidate => Boolean(skill))
    const missingIds = requestedIds.filter((id) => !availableById.has(id))
    return {
      preset,
      policy: { mode: 'only', skillIds: skills.map((skill) => skill.id), presetId: preset.id },
      skills,
      missingRoles: requestedIds.length === 0
        ? ['尚未绑定 Skill']
        : missingIds.map((id) => `已绑定 Skill 不可用：${id}`),
      customized: true
    }
  }
  const skills: SkillPresetCandidate[] = []
  const missingRoles: string[] = []

  for (const role of preset.roles) {
    if (role.genreIds && matchSkillGenre(role.genreIds, projectGenre) !== 'match') continue
    const compatibleSkills = availableSkills.filter((skill) => (
      matchSkillGenre(skill.genreIds, projectGenre) !== 'mismatch'
    ))
    const aliases = new Set(role.aliases.map(normalize))
    const match = compatibleSkills.find((skill) => aliases.has(normalize(skill.id)))
      ?? compatibleSkills.find((skill) => aliases.has(normalize(skill.name)))
      ?? (() => {
        const fallbackAliases = new Set((role.fallbackAliases ?? []).map(normalize))
        return compatibleSkills.find((skill) => fallbackAliases.has(normalize(skill.id)))
          ?? compatibleSkills.find((skill) => fallbackAliases.has(normalize(skill.name)))
      })()
    if (!match) {
      missingRoles.push(role.label)
      continue
    }
    if (!skills.some((skill) => skill.id === match.id)) skills.push(match)
  }

  return {
    preset,
    policy: { mode: 'only', skillIds: skills.map((skill) => skill.id), presetId: preset.id },
    skills,
    missingRoles,
    customized: false
  }
}
