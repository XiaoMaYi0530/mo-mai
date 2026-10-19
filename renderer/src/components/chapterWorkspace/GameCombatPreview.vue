<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { DEFAULT_COMBAT_RULES, combatActionInput, resolveCombat, rulesAtChapter, type CombatInput } from '@shared/game-combat'
import type { GameProjectRow } from '../../../../electron/main/game-progression-store'
import type { GameSnapshot } from '@shared/game-progression'
const props = defineProps<{ row: GameProjectRow }>()
const emit = defineEmits<{ saved: [] }>()
const store = useAppStore()
const message = useMessage()
const attackerId = ref('')
const defenderId = ref('')
const attacker = ref<GameSnapshot | null>(null)
const defender = ref<GameSnapshot | null>(null)
const readError = ref('')
const busy = ref(false)
const skillId = ref('')
const recorded = ref(false)
const recordedResult = ref<{ result: ReturnType<typeof resolveCombat>; healthBefore: number; manaBefore: number; manaAfter: number } | null>(null)
const actionId = ref(crypto.randomUUID())
function nextAttack() { recorded.value = false; recordedResult.value = null; actionId.value = crypto.randomUUID() }
const input = reactive<CombatInput>({ damageType: 'physical', power: 1, flat: 0, hitRoll: 50, criticalRoll: 50 })
const options = computed(() => store.characters.filter(c => props.row.data.characters.some(s => s.characterId === c.id)))
const skillOptions = computed(() => props.row.data.assets.filter(a => a.kind === 'skill' && attacker.value?.learnedSkillIds.includes(a.id)))
const selectedSkill = computed(() => skillOptions.value.find(a => a.id === skillId.value))
watch(() => [attackerId.value, defenderId.value, skillId.value, store.selectedProjectId, store.selectedChapterId, JSON.stringify(input)], nextAttack)
watch(attackerId, () => { skillId.value = '' })
watch(() => props.row, row => {
  if (recorded.value && !row.data.events.some(event => event.combatActionId === actionId.value)) nextAttack()
})
let readId = 0
watch(() => [attackerId.value, defenderId.value, store.selectedProjectId, store.selectedChapterId, props.row.revision], async () => {
  const id = ++readId
  attacker.value = null; defender.value = null; readError.value = ''
  if (!attackerId.value || !defenderId.value || !store.selectedChapterId) return
  try {
    const results = await Promise.all([attackerId.value, defenderId.value].map(characterId => window.characterArc.gameSnapshot({ projectId: store.selectedProjectId, chapterId: store.selectedChapterId, characterId })))
    if (id !== readId) return
    if (results.some(r => !r.success || !r.result)) throw new Error(results.find(r => !r.success)?.error || '读取失败')
    attacker.value = results[0].result!; defender.value = results[1].result!
  } catch (error) { if (id === readId) readError.value = String(error) }
})
const preview = computed(() => {
  if (!attacker.value || !defender.value) return null
  try {
    const data = rulesAtChapter(props.row.data, store.chapters.findIndex(c => c.id === store.selectedChapterId))
    const resolvedInput = combatActionInput(data, attacker.value, input, skillId.value)
    return { result: resolveCombat(attacker.value, defender.value, data.combatRules ?? DEFAULT_COMBAT_RULES, resolvedInput), error: '' }
  } catch (error) { return { result: null, error: String(error) } }
})
const displayedPreview = computed(() => recordedResult.value ? { result: recordedResult.value.result, error: '' } : preview.value)
const displayedHealthBefore = computed(() => recordedResult.value?.healthBefore ?? defender.value?.currentResources.health)
const displayedMana = computed(() => recordedResult.value?.manaBefore ?? attacker.value?.currentResources.mana)
async function stage() {
  if (busy.value || recorded.value) return
  const result = preview.value?.result
  if (!result || !attacker.value || !defender.value) return
  const snapshot = { result: { ...result }, healthBefore: defender.value.currentResources.health,
    manaBefore: attacker.value.currentResources.mana, manaAfter: attacker.value.currentResources.mana - (selectedSkill.value?.skill?.manaCost ?? 0) }
  busy.value = true
  try {
    const response = await window.characterArc.gameCommand({ projectId: store.selectedProjectId, expectedRevision: props.row.revision,
      command: { kind: 'combat', chapterId: store.selectedChapterId, attackerId: attackerId.value, defenderId: defenderId.value, input: { ...input }, skillId: skillId.value || undefined, actionId: actionId.value } })
    if (!response.success) throw new Error(response.error)
    recordedResult.value = snapshot
    recorded.value = true
    message.success('本次战斗已记入草稿，技能耗蓝与伤害已一起保存。'); emit('saved')
  } catch (error) { message.error(String(error)) } finally { busy.value = false }
}
</script>
<template>
  <details class="combat-preview"><summary>双方战斗试算</summary>
    <p>先为人物与怪物建立数值档案，并在规则版本中启用战斗判定。判定点数由作者填写（0 ≤ 点数 &lt; 100），小于概率时成功。</p>
    <fieldset :disabled="busy || recorded"><div class="fields">
      <label>攻击方<select v-model="attackerId"><option value="">选择人物</option><option v-for="c in options" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
      <label>防守方<select v-model="defenderId"><option value="">选择人物／怪物</option><option v-for="c in options" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
      <label>攻击方式<select v-model="skillId"><option value="">普通攻击／自定义试算</option><option v-for="s in skillOptions" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
      <label v-if="!skillId">类型<select v-model="input.damageType"><option value="physical">物理</option><option value="magic">法术</option></select></label>
      <label v-if="!skillId">属性倍率<input v-model.number="input.power" type="number" min="0" step="0.1"></label>
      <label v-if="!skillId">基础伤害<input v-model.number="input.flat" type="number" min="0"></label>
      <label>命中判定点数<input v-model.number="input.hitRoll" type="number" min="0" max="99.99" step="0.01"></label>
      <label>暴击判定点数<input v-model.number="input.criticalRoll" type="number" min="0" max="99.99" step="0.01"></label>
    </div></fieldset>
    <p v-if="selectedSkill?.skill">{{ selectedSkill.name }}：{{ selectedSkill.skill.scalingStatId === 'attack' ? '攻击' : '法强' }} × {{ selectedSkill.skill.powerMultiplier }} + {{ selectedSkill.skill.flatPower }}；耗蓝 {{ selectedSkill.skill.manaCost }}，当前魔法 {{ displayedMana }}<span v-if="recordedResult"> → {{ recordedResult.manaAfter }}</span>；冷却 {{ selectedSkill.skill.cooldownSeconds }} 秒。未命中仍会耗蓝。</p>
    <p v-if="!recorded && (readError || preview?.error)" role="alert">{{ readError || preview?.error }}</p>
    <p v-if="recorded">本次已记录，以下保留本次结算结果。准备下一次攻击后使用最新数值试算。</p>
    <template v-if="displayedPreview?.result">
      <p>命中 {{ displayedPreview.result.hitChance }}% · 暴击 {{ displayedPreview.result.criticalChance }}% · {{ displayedPreview.result.hit ? (displayedPreview.result.critical ? '暴击命中' : '命中') : '未命中' }}</p>
      <p>伤害 {{ displayedPreview.result.damage }} · 防守方生命 {{ displayedHealthBefore }} → {{ displayedPreview.result.healthAfter }}</p>
      <p>行动频率：攻击方 {{ displayedPreview.result.attackerActionsPerSecond }} 次／秒，防守方 {{ displayedPreview.result.defenderActionsPerSecond }} 次／秒。</p>
      <button :disabled="busy || recorded || (!displayedPreview.result.damage && !skillId)" @click="stage">{{ recorded ? '本次已记录' : '将本次战斗记入本章草稿' }}</button>
    </template>
    <button v-if="recorded" :disabled="busy" @click="nextAttack">准备下一次攻击</button>
    <p>保存后可在本章记录中撤销整次战斗。冷却时间与技能触发条件需结合正文时间核对；治疗、护盾等技能请通过数值事件记录。</p>
  </details>
</template>
<style scoped>
fieldset{border:0;padding:0;margin:0;min-width:0}.combat-preview{padding:12px;border:1px solid var(--arc-border);border-radius:8px;margin:12px 0;font-size:12px}summary{font-weight:600;cursor:pointer}p{line-height:1.7;color:var(--arc-text-secondary)}.fields{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}label{display:flex;align-items:center;justify-content:space-between;gap:8px}input{width:75px}input,select,button{padding:6px;border:1px solid var(--arc-border);border-radius:5px;background:var(--arc-bg-surface);color:var(--arc-text-primary)}button{cursor:pointer}button:disabled{opacity:.5}
</style>
