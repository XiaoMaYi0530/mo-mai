import type { SkillUsePolicy } from '../../../../electron/shared/assistant-runtime'
import type { SkillPresetBindings } from '../../../../electron/shared/skill-presets'

/** 初稿默认沿用项目策略；项目为自动时才采用专门配置的“正文创作”组合。 */
export function resolveFirstDraftSkillDefault(
  policy: SkillUsePolicy | undefined,
  bindings: SkillPresetBindings | undefined
): SkillUsePolicy {
  if (policy?.mode === 'off') return { mode: 'off', skillIds: [] }
  if (policy?.mode === 'only' && policy.skillIds.length > 0) {
    return { mode: 'only', skillIds: [...policy.skillIds], ...(policy.presetId ? { presetId: policy.presetId } : {}) }
  }
  const draftIds = bindings?.draft?.filter(Boolean) ?? []
  if (draftIds.length > 0) return { mode: 'only', skillIds: [...draftIds], presetId: 'draft' }
  return { mode: 'auto', skillIds: [] }
}
