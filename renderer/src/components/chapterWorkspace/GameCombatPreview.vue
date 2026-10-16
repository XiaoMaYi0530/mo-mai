<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { DEFAULT_COMBAT_RULES, resolveCombat, rulesAtChapter, type CombatInput } from '@shared/game-combat'
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
const input = reactive<CombatInput>({ damageType: 'physical', power: 1, flat: 0, hitRoll: 50, criticalRoll: 50 })
const options = computed(() => store.characters.filter(c => props.row.data.characters.some(s => s.characterId === c.id)))
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
    return { result: resolveCombat(attacker.value, defender.value, data.combatRules ?? DEFAULT_COMBAT_RULES, input), error: '' }
  } catch (error) { return { result: null, error: String(error) } }
})
async function stage() {
  busy.value = true
  try {
    const response = await window.characterArc.gameCommand({ projectId: store.selectedProjectId, expectedRevision: props.row.revision,
      command: { kind: 'combat', chapterId: store.selectedChapterId, attackerId: attackerId.value, defenderId: defenderId.value, input: { ...input } } })
    if (!response.success) throw new Error(response.error)
    message.success('伤害已记为本章草稿，请核对正文后确认。'); emit('saved')
  } catch (error) { message.error(String(error)) } finally { busy.value = false }
}
</script>
<template>
  <details class="combat-preview"><summary>双方战斗试算</summary>
    <p>先为人物与怪物建立数值档案，并在规则版本中启用战斗判定。判定点数由作者填写（0 ≤ 点数 &lt; 100），小于概率时成功。</p>
    <div class="fields">
      <label>攻击方<select v-model="attackerId"><option value="">选择人物</option><option v-for="c in options" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
      <label>防守方<select v-model="defenderId"><option value="">选择人物／怪物</option><option v-for="c in options" :key="c.id" :value="c.id">{{ c.name }}</option></select></label>
      <label>类型<select v-model="input.damageType"><option value="physical">物理</option><option value="magic">法术</option></select></label>
      <label>属性倍率<input v-model.number="input.power" type="number" min="0" step="0.1"></label>
      <label>基础伤害<input v-model.number="input.flat" type="number" min="0"></label>
      <label>命中判定点数<input v-model.number="input.hitRoll" type="number" min="0" max="99.99" step="0.01"></label>
      <label>暴击判定点数<input v-model.number="input.criticalRoll" type="number" min="0" max="99.99" step="0.01"></label>
    </div>
    <p v-if="readError || preview?.error" role="alert">{{ readError || preview?.error }}</p>
    <template v-if="preview?.result">
      <p>命中 {{ preview.result.hitChance }}% · 暴击 {{ preview.result.criticalChance }}% · {{ preview.result.hit ? (preview.result.critical ? '暴击命中' : '命中') : '未命中' }}</p>
      <p>伤害 {{ preview.result.damage }} · 防守方生命 {{ defender?.currentResources.health }} → {{ preview.result.healthAfter }}</p>
      <p>行动频率：攻击方 {{ preview.result.attackerActionsPerSecond }} 次／秒，防守方 {{ preview.result.defenderActionsPerSecond }} 次／秒。</p>
      <button :disabled="busy || !preview.result.damage" @click="stage">将本次伤害记入本章草稿</button>
    </template>
    <p>试算不自动修改正文或档案。这里只记录伤害，技能耗蓝、冷却与物品消耗需另外核对。</p>
  </details>
</template>
<style scoped>
.combat-preview{padding:12px;border:1px solid var(--arc-border);border-radius:8px;margin:12px 0;font-size:12px}summary{font-weight:600;cursor:pointer}p{line-height:1.7;color:var(--arc-text-secondary)}.fields{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}label{display:flex;align-items:center;justify-content:space-between;gap:8px}input{width:75px}input,select,button{padding:6px;border:1px solid var(--arc-border);border-radius:5px;background:var(--arc-bg-surface);color:var(--arc-text-primary)}button{cursor:pointer}button:disabled{opacity:.5}
</style>
