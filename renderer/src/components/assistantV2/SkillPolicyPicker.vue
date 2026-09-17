<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NCheckbox, NRadio, NRadioGroup } from 'naive-ui'
import type { SkillUseMode, SkillUsePolicy } from '@shared/assistant-runtime'
import {
  orderSkillsByPresetBinding,
  resolveSkillPreset,
  SKILL_PRESETS,
  type SkillPresetBindings,
  type SkillPresetId
} from '@shared/skill-presets'
import { formatSkillGenreLabels } from '@shared/skill-genres'
import type { ProjectSkillItem } from '@/types/app'

const props = withDefaults(defineProps<{
  modelValue: SkillUsePolicy
  availableSkills?: ProjectSkillItem[]
  projectGenre?: string
  skillPresetBindings?: SkillPresetBindings
  presetIds?: SkillPresetId[]
  scopeNote?: string
}>(), {
  availableSkills: () => [],
  skillPresetBindings: () => ({}),
  presetIds: () => SKILL_PRESETS.map((preset) => preset.id),
  scopeNote: '该选择只影响当前任务。'
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: SkillUsePolicy): void
}>()

const fixedSkillSource = ref<'preset' | 'manual'>('preset')
const manualSkillIdsCache = ref<string[] | null>(null)
let fixedSkillSourceInitialized = false

const resolvedSkillPresets = computed(() => props.presetIds.map((presetId) =>
  resolveSkillPreset(presetId, props.availableSkills, props.projectGenre, props.skillPresetBindings)
))
const activeResolvedSkillPreset = computed(() => {
  if (props.modelValue.mode !== 'only') return null
  const identified = props.modelValue.presetId
    ? resolvedSkillPresets.value.find((item) => item.preset.id === props.modelValue.presetId)
    : null
  return identified ?? resolvedSkillPresets.value.find((item) => (
    item.policy.skillIds.length > 0
    && item.policy.skillIds.length === props.modelValue.skillIds.length
    && item.policy.skillIds.every((id) => props.modelValue.skillIds.includes(id))
  )) ?? null
})
const orderedAvailableSkills = computed(() => orderSkillsByPresetBinding(
  props.availableSkills,
  props.modelValue.skillIds
))

function setSkillMode(mode: SkillUseMode): void {
  emit('update:modelValue', { ...props.modelValue, mode })
}

function toggleSkill(skillId: string, checked: boolean): void {
  const selected = props.modelValue.skillIds
  const skillIds = checked
    ? [...new Set([...selected, skillId])]
    : selected.filter((id) => id !== skillId)
  fixedSkillSource.value = 'manual'
  fixedSkillSourceInitialized = true
  manualSkillIdsCache.value = skillIds
  emit('update:modelValue', { mode: 'only', skillIds })
}

function setFixedSkillSource(source: 'preset' | 'manual'): void {
  if (source === fixedSkillSource.value) return
  if (source === 'manual') {
    fixedSkillSource.value = 'manual'
    fixedSkillSourceInitialized = true
    const skillIds = manualSkillIdsCache.value ?? [...props.modelValue.skillIds]
    manualSkillIdsCache.value = skillIds
    emit('update:modelValue', { mode: 'only', skillIds })
    return
  }

  manualSkillIdsCache.value = [...props.modelValue.skillIds]
  fixedSkillSource.value = 'preset'
  fixedSkillSourceInitialized = true
  if (!activeResolvedSkillPreset.value) {
    emit('update:modelValue', { mode: 'only', skillIds: [] })
  }
}

function applySkillPreset(presetId: SkillPresetId): void {
  const resolved = resolveSkillPreset(presetId, props.availableSkills, props.projectGenre, props.skillPresetBindings)
  if (resolved.missingRoles.length > 0 || resolved.policy.skillIds.length === 0) return
  fixedSkillSource.value = 'preset'
  fixedSkillSourceInitialized = true
  emit('update:modelValue', resolved.policy)
}

watch(
  () => [
    props.modelValue.mode,
    props.modelValue.skillIds.join('\u0000'),
    props.modelValue.presetId ?? '',
    resolvedSkillPresets.value.map((item) => item.policy.skillIds.join('\u0000')).join('\u0001')
  ],
  () => {
    if (props.modelValue.mode !== 'only') {
      fixedSkillSourceInitialized = false
      return
    }
    if (fixedSkillSourceInitialized) return
    fixedSkillSource.value = activeResolvedSkillPreset.value || props.modelValue.skillIds.length === 0
      ? 'preset'
      : 'manual'
    if (fixedSkillSource.value === 'manual') {
      manualSkillIdsCache.value = [...props.modelValue.skillIds]
    }
    fixedSkillSourceInitialized = true
  },
  { immediate: true }
)
</script>

<template>
  <div class="skill-policy-picker">
    <div class="skill-section-head">
      <strong>执行方式</strong>
      <small>{{ scopeNote }}</small>
    </div>
    <NRadioGroup :value="modelValue.mode" @update:value="setSkillMode">
      <div class="skill-mode-list">
        <NRadio value="auto">自动匹配</NRadio>
        <NRadio value="only">固定使用</NRadio>
        <NRadio value="off">不使用</NRadio>
      </div>
    </NRadioGroup>

    <template v-if="modelValue.mode === 'only'">
      <div class="skill-section-head skill-fixed-source-head">
        <strong>选择 Skill 的方式</strong>
        <small>选择组合，或自行挑选。</small>
      </div>
      <div class="skill-source-switch" role="group" aria-label="选择 Skill 的方式">
        <button type="button" :class="{ active: fixedSkillSource === 'preset' }" @click="setFixedSkillSource('preset')">
          快捷组合
        </button>
        <button type="button" :class="{ active: fixedSkillSource === 'manual' }" @click="setFixedSkillSource('manual')">
          手动选择
        </button>
      </div>

      <template v-if="fixedSkillSource === 'preset'">
        <div class="skill-preset-list">
          <button
            v-for="item in resolvedSkillPresets"
            :key="item.preset.id"
            type="button"
            class="skill-preset-button"
            :class="{ active: activeResolvedSkillPreset?.preset.id === item.preset.id }"
            :disabled="item.missingRoles.length > 0"
            :title="item.missingRoles.length ? `缺少：${item.missingRoles.join('、')}` : item.preset.description"
            @click="applySkillPreset(item.preset.id)"
          >
            <strong>{{ item.preset.name }}</strong>
            <span>{{ item.skills.length > 0 ? `${item.skills.length} 个 Skill` : '未配置可用 Skill' }}</span>
          </button>
        </div>
        <div v-if="activeResolvedSkillPreset" class="skill-active-preset arc-scrollbar">
          <div class="skill-active-preset-head">
            <strong>{{ activeResolvedSkillPreset.preset.name }}</strong>
            <small>组合内容只读，请到项目设置修改。</small>
          </div>
          <div class="skill-preset-member-list">
            <div v-for="skill in activeResolvedSkillPreset.skills" :key="skill.id" class="skill-preset-member">
              <span class="skill-preset-member-dot" />
              <span class="skill-option-copy">
                <strong>{{ skill.name }}</strong>
                <small>题材：{{ formatSkillGenreLabels(skill.genreIds) }} · {{ skill.description || '未提供功能说明' }}</small>
              </span>
            </div>
          </div>
        </div>
        <span v-else class="skill-empty skill-preset-empty">请选择一个快捷组合。</span>
      </template>

      <div v-else class="skill-only-list arc-scrollbar">
        <span v-if="availableSkills.length === 0" class="skill-empty">当前项目没有已启用的可用 Skill。</span>
        <template v-else>
          <NCheckbox
            v-for="skill in orderedAvailableSkills"
            :key="skill.id"
            :checked="modelValue.skillIds.includes(skill.id)"
            @update:checked="toggleSkill(skill.id, $event)"
          >
            <span class="skill-option-copy">
              <strong>{{ skill.name }}</strong>
              <small>题材：{{ formatSkillGenreLabels(skill.genreIds) }} · {{ skill.description || '未提供功能说明' }}</small>
            </span>
          </NCheckbox>
        </template>
      </div>
    </template>

    <small v-if="modelValue.mode === 'only' && modelValue.skillIds.length === 0" class="skill-warning">
      请至少选择一个 Skill。
    </small>
  </div>
</template>

<style scoped>
.skill-policy-picker { display: flex; flex-direction: column; gap: 10px; }
.skill-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.skill-section-head strong { color: var(--arc-text-primary); font-size: 11.5px; }
.skill-section-head small { color: var(--arc-text-hint); font-size: 9.5px; }
.skill-fixed-source-head { margin-top: 1px; padding-top: 9px; border-top: 1px solid var(--arc-border); }
.skill-mode-list,
.skill-only-list { display: flex; flex-direction: column; gap: 7px; }
.skill-source-switch { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 2px; border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-body); }
.skill-source-switch button { padding: 6px 10px; border: 0; border-radius: 6px; background: transparent; color: var(--arc-text-secondary); font-size: 11.5px; cursor: pointer; }
.skill-source-switch button.active { background: var(--arc-bg-surface); color: var(--arc-primary); box-shadow: 0 1px 4px color-mix(in srgb, var(--arc-text-primary) 10%, transparent); font-weight: 600; }
.skill-preset-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.skill-preset-button { display: flex; min-width: 0; flex-direction: column; gap: 3px; padding: 8px 9px; border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-surface); color: var(--arc-text-secondary); text-align: left; cursor: pointer; }
.skill-preset-button strong { color: var(--arc-text-primary); font-size: 11.5px; }
.skill-preset-button span { display: -webkit-box; overflow: hidden; color: var(--arc-text-hint); font-size: 10px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.skill-preset-button:hover:not(:disabled),
.skill-preset-button.active { border-color: color-mix(in srgb, var(--arc-primary) 48%, var(--arc-border)); background: var(--arc-primary-soft); }
.skill-preset-button:disabled { cursor: not-allowed; opacity: 0.42; }
.skill-active-preset { display: flex; flex-direction: column; gap: 7px; max-height: 210px; padding: 9px 10px; overflow-y: auto; border: 1px solid var(--arc-border); border-radius: 8px; }
.skill-active-preset-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.skill-active-preset-head strong { color: var(--arc-text-primary); font-size: 11.5px; }
.skill-active-preset-head small { color: var(--arc-text-hint); font-size: 9.5px; }
.skill-preset-member-list { display: flex; flex-direction: column; gap: 7px; }
.skill-preset-member { display: flex; min-width: 0; align-items: flex-start; gap: 7px; }
.skill-preset-member-dot { flex: 0 0 auto; width: 6px; height: 6px; margin-top: 5px; border-radius: 999px; background: var(--arc-primary); }
.skill-option-copy { display: inline-flex; min-width: 0; flex-direction: column; gap: 1px; vertical-align: top; }
.skill-option-copy strong { color: var(--arc-text-primary); font-size: 11.5px; }
.skill-option-copy small { max-width: 460px; overflow: hidden; color: var(--arc-text-hint); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.skill-only-list { max-height: 240px; padding: 9px 10px; overflow-y: auto; border: 1px solid var(--arc-border); border-radius: 8px; }
.skill-empty,
.skill-warning { color: var(--arc-text-hint); font-size: 11px; line-height: 1.5; }
.skill-preset-empty { padding: 9px 10px; border: 1px dashed var(--arc-border); border-radius: 8px; }
.skill-warning { color: var(--arc-danger, #d03050); }
</style>
