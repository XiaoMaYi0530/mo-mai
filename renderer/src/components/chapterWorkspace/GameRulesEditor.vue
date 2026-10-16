<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { DEFAULT_COMBAT_RULES, rulesAtChapter, type CombatRules } from '@shared/game-combat'
import type { GameProjectRow } from '../../../../electron/main/game-progression-store'
import type { GameDerivedRules } from '@shared/game-progression'
const props = defineProps<{ row: GameProjectRow }>()
const emit = defineEmits<{ saved: [] }>()
const store = useAppStore()
const message = useMessage()
const busy = ref(false)
const flatPrecision = ref(0)
const percentPrecision = ref(2)
const derived = reactive({} as GameDerivedRules)
const combat = reactive({ ...DEFAULT_COMBAT_RULES })
const index = computed(() => store.chapters.findIndex(c => c.id === store.selectedChapterId))
const labels: Record<keyof GameDerivedRules, string> = {
  healthPerConstitution: '每点体质 → 生命', manaPerIntelligence: '每点智力 → 魔法', attackPerStrength: '每点力量 → 攻击',
  spellPowerPerIntelligence: '每点智力 → 法强', speedPerAgility: '每点敏捷 → 速度', dodgePerAgility: '每点敏捷 → 闪避百分点', criticalPerAgility: '每点敏捷 → 暴击百分点'
}
const combatLabels: Record<Exclude<keyof CombatRules, 'enabled'>, string> = {
  baseHit: '基础命中率 %', minHit: '最低命中率 %', maxHit: '最高命中率 %', dodgeCap: '有效闪避上限 %', criticalCap: '暴击上限 %',
  criticalMultiplier: '暴击倍率', defenseScale: '防御折算系数', baseSpeed: '基准速度', baseActionsPerSecond: '基准每秒行动次数', maxActionsPerSecond: '每秒行动次数上限'
}
watch(() => [props.row.revision, index.value], () => {
  const rules = rulesAtChapter(props.row.data, index.value)
  Object.assign(derived, rules.derivedRules)
  Object.assign(combat, rules.combatRules ?? DEFAULT_COMBAT_RULES)
  flatPrecision.value = rules.flatPrecision ?? 0
  percentPrecision.value = rules.percentPrecision ?? 2
}, { immediate: true })
const canSave = computed(() => index.value >= 0 && store.selectedChapter?.status !== 'final'
  && !props.row.data.events.some(e => !e.orphaned && e.chapterIndex >= index.value)
  && !(props.row.data.ruleVersions ?? []).some(v => v.chapterIndex >= index.value))
async function save() {
  busy.value = true
  try {
    const result = await window.characterArc.gameCommand({ projectId: store.selectedProjectId, expectedRevision: props.row.revision,
      command: { kind: 'version-rules', chapterId: store.selectedChapterId, derivedRules: { ...derived }, flatPrecision: flatPrecision.value,
        percentPrecision: percentPrecision.value, combatRules: { ...combat } } })
    if (!result.success) throw new Error(result.error)
    message.success('规则版本已保存，从本章起生效。')
    emit('saved')
  } catch (error) { message.error(String(error)) } finally { busy.value = false }
}
</script>
<template>
  <details class="rules-editor">
    <summary>属性精度与战斗规则版本</summary>
    <p>修改从当前章《{{ store.selectedChapter?.title || '未选择' }}》起生效，较早章节保持原规则。旧版档案保持整数截断，保存新版本后采用所选小数精度。</p>
    <div class="fields">
      <label>普通属性小数位<input v-model.number="flatPrecision" type="number" min="0" max="4"></label>
      <label>百分比属性小数位<input v-model.number="percentPrecision" type="number" min="0" max="4"></label>
      <label v-for="(label, key) in labels" :key="key">{{ label }}<input v-model.number="derived[key]" type="number" min="0" step="0.01"></label>
    </div>
    <label class="enable"><input v-model="combat.enabled" type="checkbox">启用战斗判定</label>
    <div v-if="combat.enabled" class="fields"><label v-for="(label, key) in combatLabels" :key="key">{{ label }}<input v-model.number="combat[key]" type="number" min="0" step="0.01"></label></div>
    <p>命中率＝基础命中＋攻击方命中－有效闪避，再限制到命中上下限；暴击不超过设定上限。面板闪避保留原值，战斗时使用上限。</p>
    <p>伤害＝向下取整［（攻击或法强 × 倍率＋基础伤害）× 防御系数 ÷（防御系数＋防御或魔抗）×（暴击时使用暴击倍率，否则为 1）］。未命中伤害为 0。</p>
    <p>每秒行动次数＝速度 ÷ 基准速度 × 基准次数，限制在 0 与上限之间；只是参考频率，不自动模拟连续战斗。</p>
    <button :disabled="busy || !canSave" @click="save">保存为从本章起生效的新版本</button>
    <p v-if="!canSave">请选择未定稿、位于已有数值记录及规则版本之后的章节。</p>
    <ul><li v-for="version in row.data.ruleVersions" :key="version.id">从《{{ store.chapters.find(c => c.id === version.effectiveChapterId)?.title || '已删除章节' }}》生效 · 百分比 {{ version.percentPrecision }} 位 · 战斗{{ version.combatRules.enabled ? '开启' : '关闭' }}</li></ul>
  </details>
</template>
<style scoped>
.rules-editor { border:1px solid var(--arc-border); padding:12px; border-radius:8px; margin:12px 0; font-size:12px; }
summary { cursor:pointer; font-weight:600; } p { line-height:1.7; color:var(--arc-text-secondary); }
.fields { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; }
label { display:flex; align-items:center; justify-content:space-between; gap:8px; } input[type=number] { width:72px; }
input,button { color:var(--arc-text-primary); background:var(--arc-bg-surface); border:1px solid var(--arc-border); border-radius:5px; padding:6px; } button { cursor:pointer; margin-top:12px; } button:disabled{opacity:.5;cursor:not-allowed}.enable{justify-content:flex-start;margin:12px 0}
</style>
