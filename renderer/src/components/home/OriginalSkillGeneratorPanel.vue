<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NSelect, useMessage } from 'naive-ui'
import { BookOpenCheck, RefreshCw, Sparkles, Trash2 } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { GameAsset } from '@shared/game-progression'
import {
  calculateOriginalSkillCount,
  generateOriginalSkills,
  type OriginalSkillRarity,
  type OriginalSkillStyle,
  type OriginalSkillType
} from '@shared/original-skill-generator'
import type { GameCommand, GameProjectRow } from '../../../../electron/main/game-progression-store'

const appStore = useAppStore()
const message = useMessage()
const selectedProjectId = ref(appStore.selectedProjectId || appStore.projects[0]?.id || '')
const row = ref<GameProjectRow | null>(null)
const busy = ref(false)
const style = ref<OriginalSkillStyle>('东方玄幻')
const rarity = ref<OriginalSkillRarity>('混合')
const levelMin = ref(1)
const levelMax = ref(50)
const levelStep = ref(5)
const skillsPerStage = ref(3)
const types = ref<OriginalSkillType[]>(['spell', 'combat'])
const elements = ref<string[]>(['火', '水', '风', '土'])
const preview = ref<GameAsset[]>([])

const projectOptions = computed(() => appStore.projects.map((project) => ({ label: project.title, value: project.id })))
const styleOptions = ['东方玄幻', '西式奇幻', '仙侠', '科幻'].map((value) => ({ label: value, value }))
const rarityOptions = ['混合', '普通', '精良', '稀有', '史诗', '传说'].map((value) => ({ label: value, value }))
const typeOptions = [
  { label: '法术', value: 'spell' }, { label: '战技', value: 'combat' }, { label: '身法', value: 'movement' },
  { label: '治疗', value: 'healing' }, { label: '控制', value: 'control' }, { label: '辅助', value: 'support' }
]
const elementOptions = ['火', '水', '风', '土', '雷', '冰', '光', '暗', '无属性'].map((value) => ({ label: value, value }))
const plannedCount = computed(() => calculateOriginalSkillCount({
  levelMin: Number(levelMin.value), levelMax: Number(levelMax.value), levelStep: Number(levelStep.value),
  skillsPerStage: Number(skillsPerStage.value), style: style.value, rarity: rarity.value, types: types.value,
  elements: elements.value, stats: row.value?.data.stats.map(({ id, name }) => ({ id, name })) ?? [],
  tierRules: row.value?.data.tierRules,
  seed: '', existingNames: row.value?.data.assets.map((asset) => asset.name) ?? []
}))
const projectName = computed(() => appStore.projects.find((project) => project.id === selectedProjectId.value)?.title ?? '')
const typeName = (type?: OriginalSkillType): string => typeOptions.find((entry) => entry.value === type)?.label ?? '技能'
const outcomeName = (value?: string): string => ({ damage: '伤害', healing: '治疗', shield: '护盾', movement: '位移', control: '控制', buff: '增益', debuff: '减益', summon: '召唤' }[value ?? ''] ?? value ?? '')
const targetName = (value?: string): string => ({ self: '自身', single: '单体', line: '直线', cone: '扇形', area: '范围', multiple: '多目标' }[value ?? ''] ?? value ?? '')
const tierName = (asset: GameAsset): string => asset.tags.find((tag) => tag.endsWith('位阶')) ?? ''

async function loadProject(): Promise<void> {
  preview.value = []
  if (!selectedProjectId.value) { row.value = null; return }
  const result = await window.characterArc.gameRead(selectedProjectId.value)
  if (!result.success || !result.result) { message.error(result.error || '读取作品数值档案失败'); return }
  row.value = result.result
}

async function command(next: GameCommand): Promise<boolean> {
  if (!row.value || busy.value) return false
  busy.value = true
  try {
    const result = await window.characterArc.gameCommand({ projectId: selectedProjectId.value, expectedRevision: row.value.revision, command: toIpcPayload(next) })
    if (!result.success || !result.result) { message.error(result.error || '保存失败'); await loadProject(); return false }
    row.value = result.result
    return true
  } finally { busy.value = false }
}

function generatePreview(): void {
  if (!row.value) return
  try {
    preview.value = generateOriginalSkills({
      levelMin: Number(levelMin.value), levelMax: Number(levelMax.value), levelStep: Number(levelStep.value),
      skillsPerStage: Number(skillsPerStage.value), style: style.value, rarity: rarity.value,
      types: types.value, elements: elements.value,
      stats: row.value.data.stats.map(({ id, name }) => ({ id, name })), tierRules: row.value.data.tierRules, seed: crypto.randomUUID(),
      existingNames: row.value.data.assets.map((asset) => asset.name)
    })
    message.success(`已生成 ${preview.value.length} 个技能预览，确认后才会入库`)
  } catch (error) { preview.value = []; message.error(error instanceof Error ? error.message : '生成条件无效') }
}

async function savePreview(): Promise<void> {
  if (!preview.value.length) return
  const assets = toIpcPayload(preview.value)
  if (await command({ kind: 'import-assets', assets })) {
    preview.value = []
    message.success(`已将 ${assets.length} 个原创技能加入“${projectName.value}”`)
  }
}

watch(selectedProjectId, () => { void loadProject() })
watch([style, rarity, levelMin, levelMax, levelStep, skillsPerStage, types, elements], () => { preview.value = [] }, { deep: true })
onMounted(() => { void loadProject() })
</script>

<template>
  <section class="skill-generator">
    <header class="hero"><div class="hero-icon"><BookOpenCheck :size="28" /></div><div><span>游戏数值高级工具</span><h1>原创技能／法术库</h1><p>法术和战技统一作为技能，全部消耗魔法值；只有学会的技能才会进入人物信息。</p></div></header>
    <NEmpty v-if="!appStore.projects.length" description="请先创建一个作品。" />
    <div v-else class="layout">
      <section class="form-card">
        <label class="field"><span>目标作品</span><NSelect v-model:value="selectedProjectId" :options="projectOptions" /></label>
        <NAlert v-if="row && !row.data.enabled" type="warning" :show-icon="false">技能可以入库，但当前作品未启用游戏数值，章节 AI 暂不会读取。</NAlert>
        <template v-if="row">
          <div class="grid">
            <label class="field"><span>命名风格</span><NSelect v-model:value="style" :options="styleOptions" /></label>
            <label class="field"><span>品质分布</span><NSelect v-model:value="rarity" :options="rarityOptions" /></label>
            <label class="field"><span>最低等级</span><input v-model.number="levelMin" type="number" min="1" max="1000" /></label>
            <label class="field"><span>最高等级</span><input v-model.number="levelMax" type="number" min="1" max="1000" /></label>
            <label class="field"><span>每隔多少级一阶段</span><input v-model.number="levelStep" type="number" min="1" max="100" /></label>
            <label class="field"><span>每阶段技能数</span><input v-model.number="skillsPerStage" type="number" min="1" max="20" /></label>
          </div>
          <label class="field"><span>技能类型</span><NSelect v-model:value="types" multiple :options="typeOptions" /></label>
          <label class="field"><span>元素／力量属性</span><NSelect v-model:value="elements" multiple tag :options="elementOptions" /></label>
          <div class="summary" :class="{ warning: plannedCount > 300 }"><Sparkles :size="20" /><div><strong>预计生成 {{ plannedCount }} 个</strong><span>默认每 5 级一阶段，自动计算魔法消耗、冷却、施法时间和范围。</span></div></div>
          <NButton type="primary" size="large" :disabled="plannedCount < 1 || plannedCount > 300" @click="generatePreview"><template #icon><RefreshCw :size="17" /></template>{{ preview.length ? '换一批预览' : '生成技能预览' }}</NButton>
        </template>
      </section>
      <section class="preview-card">
        <div class="preview-head"><div><strong>生成预览</strong><span>可先剔除不满意的技能</span></div><NButton v-if="preview.length" type="primary" :loading="busy" @click="savePreview">全部加入当前作品</NButton></div>
        <div v-if="preview.length" class="preview-list arc-scrollbar"><article v-for="asset in preview" :key="asset.id" class="skill-card"><div class="card-head"><div><strong>{{ asset.name }}</strong><span>{{ asset.rarity }}</span></div><button @click="preview = preview.filter((item) => item.id !== asset.id)"><Trash2 :size="15" /></button></div><div class="meta"><span>{{ typeName(asset.skill?.type) }}</span><span>{{ asset.skill?.element }}</span><span>{{ outcomeName(asset.skill?.outcome) }}</span><span>{{ tierName(asset) }}</span><span>需求 {{ asset.levelRequirement }} 级</span></div><p class="cost">耗蓝 {{ asset.skill?.manaCost }} · 冷却 {{ asset.skill?.cooldownSeconds }}s · {{ asset.skill?.range }} · {{ targetName(asset.skill?.target) }}</p><p class="mechanic">{{ asset.skill?.effect }}</p><p v-if="asset.skill?.condition">条件：{{ asset.skill.condition }}</p><p v-if="asset.skill?.sideEffect">代价：{{ asset.skill.sideEffect }}</p><p v-if="asset.skill?.prose" class="prose">小说表现：{{ asset.skill.prose }}</p></article></div>
        <NEmpty v-else description="设置条件后，生成技能预览。" />
      </section>
    </div>
  </section>
</template>

<style scoped>
.skill-generator{width:min(100%,1280px);margin:0 auto;color:var(--arc-text-primary)}.hero{display:flex;align-items:center;gap:16px;margin-bottom:20px}.hero-icon{display:grid;place-items:center;width:54px;height:54px;flex:none;border-radius:16px;background:var(--arc-primary-soft);color:var(--arc-primary)}.hero span{color:var(--arc-primary);font-size:11px;font-weight:800;letter-spacing:.08em}.hero h1{margin:2px 0 3px;font-size:28px}.hero p{margin:0;color:var(--arc-text-secondary);font-size:13px}.layout{display:grid;grid-template-columns:minmax(360px,470px) minmax(0,1fr);gap:16px;align-items:start}.form-card,.preview-card{padding:16px;border:1px solid var(--arc-border);border-radius:14px;background:var(--arc-bg-surface);box-shadow:var(--arc-shadow-sm)}.form-card{display:flex;flex-direction:column;gap:13px}.preview-card{min-height:540px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field{display:flex;min-width:0;flex-direction:column;gap:5px}.field>span{color:var(--arc-text-secondary);font-size:12px;font-weight:650}.field>input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;color:var(--arc-text-primary);border:1px solid var(--arc-border);border-radius:6px;background:var(--arc-bg-surface)}.summary{display:flex;gap:10px;padding:12px;border:1px solid color-mix(in srgb,var(--arc-primary) 35%,var(--arc-border));border-radius:10px;background:var(--arc-primary-soft);color:var(--arc-primary)}.summary.warning{color:var(--arc-danger);border-color:var(--arc-danger)}.summary div,.preview-head>div{display:flex;flex-direction:column;gap:3px}.summary span,.preview-head span{color:var(--arc-text-hint);font-size:11px}.preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.preview-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:650px;overflow:auto}.skill-card{padding:11px;border:1px solid var(--arc-border);border-radius:10px;background:var(--arc-bg-weak)}.card-head,.card-head>div,.meta{display:flex;align-items:center;gap:7px}.card-head{justify-content:space-between}.card-head span{color:#a47734;font-size:10px;font-weight:750}.card-head button{display:grid;place-items:center;border:0;background:transparent;color:var(--arc-text-hint);cursor:pointer}.meta{flex-wrap:wrap;margin:7px 0;color:var(--arc-text-hint);font-size:10px}.cost{color:var(--arc-primary)!important;font-weight:700}.mechanic{color:var(--arc-text-primary)!important}.prose{padding-top:5px;border-top:1px dashed var(--arc-border);font-style:italic}.skill-card p{margin:4px 0 0;color:var(--arc-text-secondary);font-size:11px;line-height:1.5}@media(max-width:960px){.layout{grid-template-columns:1fr}}@media(max-width:620px){.grid,.preview-list{grid-template-columns:1fr}}
</style>
