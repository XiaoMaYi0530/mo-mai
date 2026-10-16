<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NAlert, NButton, NEmpty, NRadioButton, NRadioGroup, NSelect, useMessage } from 'naive-ui'
import { Boxes, RefreshCw, Sparkles, Trash2 } from 'lucide-vue-next'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { isGameSlotEnabled, type GameAsset } from '@shared/game-progression'
import {
  calculateOriginalEquipmentCount,
  generateOriginalEquipment,
  type OriginalEquipmentIntensity,
  type OriginalEquipmentMode,
  type OriginalEquipmentRarity,
  type OriginalEquipmentRequest,
  type OriginalEquipmentStyle
} from '@shared/original-equipment-generator'
import type { GameCommand, GameProjectRow } from '../../../../electron/main/game-progression-store'

const appStore = useAppStore()
const message = useMessage()
const selectedProjectId = ref(appStore.selectedProjectId || appStore.projects[0]?.id || '')
const row = ref<GameProjectRow | null>(null)
const busy = ref(false)
const loading = ref(false)
const mode = ref<OriginalEquipmentMode>('stages')
const style = ref<OriginalEquipmentStyle>('东方玄幻')
const rarity = ref<OriginalEquipmentRarity>('混合')
const intensity = ref<OriginalEquipmentIntensity>('standard')
const levelMin = ref(1)
const levelMax = ref(50)
const levelStep = ref(5)
const itemsPerSlot = ref(1)
const supplementCount = ref(12)
const selectedSlotIds = ref<string[]>([])
const preview = ref<GameAsset[]>([])

const projectOptions = computed(() => appStore.projects.map((project) => ({ label: project.title, value: project.id })))
const slotOptions = computed(() => {
  if (!row.value) return []
  const data = row.value.data
  const visualOnly = new Set(['ring1', 'ring2', 'accessory1', 'accessory2'])
  return data.slots
    .filter((slot) => !visualOnly.has(slot.id))
    .filter((slot) => {
      if (slot.id === 'ring') return ['ring1', 'ring2'].some((id) => isGameSlotEnabled(data, id))
      if (slot.id === 'accessory') return ['accessory1', 'accessory2'].some((id) => isGameSlotEnabled(data, id))
      return slot.enabled !== false
    })
    .map((slot) => ({
      label: slot.id === 'ring' ? `${slot.name} · 每阶段2件`
        : slot.id === 'accessory' ? `${slot.name} · 每阶段2件` : slot.name,
      value: slot.id
    }))
})
const styleOptions = ['东方玄幻', '西式奇幻', '仙侠', '科幻'].map((value) => ({ label: value, value }))
const rarityOptions = ['混合', '普通', '精良', '稀有', '史诗', '传说'].map((value) => ({ label: value, value }))
const intensityOptions = [
  { label: '克制（低数值）', value: 'conservative' },
  { label: '标准', value: 'standard' },
  { label: '英雄（高数值）', value: 'heroic' }
]
const request = computed<OriginalEquipmentRequest>(() => ({
  stats: row.value?.data.stats ?? [],
  slots: row.value?.data.slots ?? [],
  slotIds: selectedSlotIds.value,
  levelMin: Number(levelMin.value),
  levelMax: Number(levelMax.value),
  mode: mode.value,
  levelStep: Number(levelStep.value),
  itemsPerSlot: Number(itemsPerSlot.value),
  count: Number(supplementCount.value),
  rarity: rarity.value,
  style: style.value,
  intensity: intensity.value,
  tierRules: row.value?.data.tierRules,
  seed: '',
  existingNames: row.value?.data.assets.map((asset) => asset.name) ?? []
}))
const plannedCount = computed(() => calculateOriginalEquipmentCount(request.value))
const stageCount = computed(() => mode.value === 'stages' && levelStep.value > 0 && levelMax.value >= levelMin.value
  ? Math.ceil((levelMax.value - levelMin.value + 1) / levelStep.value) : 0)
const projectName = computed(() => appStore.projects.find((project) => project.id === selectedProjectId.value)?.title ?? '')

function slotName(slotId: string): string {
  return row.value?.data.slots.find((slot) => slot.id === slotId)?.name ?? slotId
}

function statName(statId: string): string {
  return row.value?.data.stats.find((stat) => stat.id === statId)?.name ?? statId
}

function bonusText(asset: GameAsset): string {
  return Object.entries(asset.bonuses)
    .map(([id, value]) => `${statName(id)} ${value >= 0 ? '+' : ''}${value}`)
    .join(' · ')
}

function tierName(asset: GameAsset): string {
  return asset.tags.find((tag) => tag.endsWith('位阶')) ?? ''
}

async function loadProject(): Promise<void> {
  preview.value = []
  if (!selectedProjectId.value) { row.value = null; return }
  loading.value = true
  try {
    const result = await window.characterArc.gameRead(selectedProjectId.value)
    if (!result.success || !result.result) { message.error(result.error || '读取作品数值档案失败'); return }
    row.value = result.result
    const available = new Set(slotOptions.value.map((option) => option.value))
    selectedSlotIds.value = selectedSlotIds.value.filter((id) => available.has(id))
    if (!selectedSlotIds.value.length) {
      const defaultSlots = [...available].filter((id) => id !== 'twohand')
      selectedSlotIds.value = defaultSlots.length ? defaultSlots : [...available]
    }
  } finally {
    loading.value = false
  }
}

async function command(next: GameCommand): Promise<boolean> {
  if (!row.value || busy.value) return false
  busy.value = true
  try {
    const result = await window.characterArc.gameCommand({
      projectId: selectedProjectId.value,
      expectedRevision: row.value.revision,
      command: toIpcPayload(next)
    })
    if (!result.success || !result.result) {
      message.error(result.error || '保存失败')
      await loadProject()
      return false
    }
    row.value = result.result
    return true
  } finally {
    busy.value = false
  }
}

async function enableGameData(): Promise<void> {
  if (await command({ kind: 'configure', enabled: true })) message.success('已为当前作品启用游戏数值档案')
}

function generatePreview(): void {
  if (!row.value) return
  try {
    preview.value = generateOriginalEquipment({ ...request.value, seed: crypto.randomUUID() })
    message.success(`已生成 ${preview.value.length} 件预览，确认后才会写入作品目录`)
  } catch (error) {
    preview.value = []
    message.error(error instanceof Error ? error.message : '生成条件无效')
  }
}

function removePreview(assetId: string): void {
  preview.value = preview.value.filter((asset) => asset.id !== assetId)
}

async function savePreview(): Promise<void> {
  if (!preview.value.length) return
  const assets = toIpcPayload(preview.value)
  if (await command({ kind: 'import-assets', assets })) {
    preview.value = []
    message.success(`已将 ${assets.length} 件原创装备加入“${projectName.value}”`)
  }
}

watch(selectedProjectId, () => { void loadProject() })
watch([mode, style, rarity, intensity, levelMin, levelMax, levelStep, itemsPerSlot, supplementCount, selectedSlotIds], () => {
  preview.value = []
}, { deep: true })
onMounted(() => { void loadProject() })
</script>

<template>
  <section class="generator-panel">
    <header class="generator-hero">
      <div class="generator-hero-icon"><Boxes :size="28" /></div>
      <div><span>游戏数值高级工具</span><h1>原创装备库生成器</h1><p>按作品自己的属性、装备槽和等级阶段，建立可搜索、可换装的原创装备目录。</p></div>
    </header>

    <NEmpty v-if="!appStore.projects.length" description="请先创建一个作品，再生成装备库。" />
    <template v-else>
      <div class="generator-layout">
        <section class="generator-form-card">
          <div class="form-section">
            <label class="field"><span>目标作品</span><NSelect v-model:value="selectedProjectId" :options="projectOptions" /></label>
            <NAlert v-if="row && !row.data.enabled" type="warning" :show-icon="false">
              <div class="enable-warning"><span>当前作品尚未启用游戏数值档案。可以先生成目录，但章节 AI 不会读取这些装备。</span><NButton size="small" :loading="busy" @click="enableGameData">立即启用</NButton></div>
            </NAlert>
          </div>

          <template v-if="row">
            <div class="form-section">
              <div class="section-title"><strong>生成方式</strong><span>推荐按等级阶段生成完整成长线</span></div>
              <NRadioGroup v-model:value="mode" name="equipment-mode">
                <NRadioButton value="stages">按等级阶段生成整套</NRadioButton>
                <NRadioButton value="supplement">按槽位补充生成</NRadioButton>
              </NRadioGroup>
            </div>

            <div class="form-section form-grid">
              <label class="field"><span>命名风格</span><NSelect v-model:value="style" :options="styleOptions" /></label>
              <label class="field"><span>品质分布</span><NSelect v-model:value="rarity" :options="rarityOptions" /></label>
              <label class="field"><span>数值强度</span><NSelect v-model:value="intensity" :options="intensityOptions" /></label>
              <label v-if="mode === 'supplement'" class="field"><span>补充数量</span><input v-model.number="supplementCount" type="number" min="1" max="300" /></label>
              <label class="field"><span>最低等级</span><input v-model.number="levelMin" type="number" min="1" max="1000" /></label>
              <label class="field"><span>最高等级</span><input v-model.number="levelMax" type="number" min="1" max="1000" /></label>
              <label v-if="mode === 'stages'" class="field"><span>每隔多少级一阶段</span><input v-model.number="levelStep" type="number" min="1" max="100" /></label>
              <label v-if="mode === 'stages'" class="field"><span>每阶段每槽位</span><input v-model.number="itemsPerSlot" type="number" min="1" max="5" /></label>
            </div>

            <div class="form-section">
              <label class="field"><span>生成槽位</span><NSelect v-model:value="selectedSlotIds" multiple :options="slotOptions" placeholder="至少选择一个槽位" /></label>
              <p class="slot-hint">戒指和饰品按通用槽位生成，可装备到任一对应格；关闭的装备槽不会参与生成。</p>
            </div>

            <div class="generation-summary" :class="{ warning: plannedCount > 300 }">
              <Sparkles :size="20" />
              <div v-if="mode === 'stages'"><strong>预计生成 {{ plannedCount }} 件</strong><span>{{ stageCount }} 个阶段 × 所选实体槽位 × 每槽 {{ itemsPerSlot }} 件；默认每5级一个阶段，戒指和饰品各按两个位置计算。</span></div>
              <div v-else><strong>预计生成 {{ plannedCount }} 件</strong><span>在 {{ levelMin }}–{{ levelMax }} 级之间，按所选槽位轮流补充。</span></div>
            </div>

            <NButton type="primary" size="large" :disabled="loading || plannedCount < 1 || plannedCount > 300" @click="generatePreview">
              <template #icon><RefreshCw :size="17" /></template>
              {{ preview.length ? '换一批预览' : '生成装备预览' }}
            </NButton>
          </template>
        </section>

        <section class="preview-card">
          <div class="preview-head"><div><strong>生成预览</strong><span>可先剔除不满意的装备，再统一入库</span></div><NButton v-if="preview.length" type="primary" :loading="busy" @click="savePreview">全部加入当前作品</NButton></div>
          <div v-if="preview.length" class="preview-list arc-scrollbar">
            <article v-for="asset in preview" :key="asset.id" class="equipment-card">
              <div class="equipment-card-head"><div><strong>{{ asset.name }}</strong><span>{{ asset.rarity }}</span></div><button title="从预览剔除" @click="removePreview(asset.id)"><Trash2 :size="15" /></button></div>
              <div class="equipment-meta"><span>{{ slotName(asset.slotId) }}</span><span>{{ tierName(asset) }}</span><span>需求等级 {{ asset.levelRequirement }}</span></div>
              <p class="equipment-bonus">{{ bonusText(asset) }}</p>
              <p>{{ asset.description }}</p>
            </article>
          </div>
          <NEmpty v-else description="设置生成条件后，点击“生成装备预览”。" />
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped>
.generator-panel{width:min(100%,1280px);margin:0 auto;color:var(--arc-text-primary)}
.generator-hero{display:flex;align-items:center;gap:16px;margin-bottom:20px}.generator-hero-icon{display:grid;place-items:center;width:54px;height:54px;flex:none;border-radius:16px;background:var(--arc-primary-soft);color:var(--arc-primary)}.generator-hero span{color:var(--arc-primary);font-size:11px;font-weight:800;letter-spacing:.08em}.generator-hero h1{margin:2px 0 3px;font-size:28px;line-height:1.2}.generator-hero p{margin:0;color:var(--arc-text-secondary);font-size:13px}
.generator-layout{display:grid;grid-template-columns:minmax(360px,470px) minmax(0,1fr);gap:16px;align-items:start}.generator-form-card,.preview-card{border:1px solid var(--arc-border);border-radius:14px;background:var(--arc-bg-surface);box-shadow:var(--arc-shadow-sm)}.generator-form-card{padding:16px}.preview-card{min-height:560px;padding:16px}
.form-section{display:flex;flex-direction:column;gap:9px;padding:14px 0;border-top:1px solid var(--arc-border)}.form-section:first-child{padding-top:0;border-top:0}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.field{display:flex;min-width:0;flex-direction:column;gap:5px}.field>span{color:var(--arc-text-secondary);font-size:12px;font-weight:650}.field>input{box-sizing:border-box;width:100%;height:34px;padding:0 10px;color:var(--arc-text-primary);border:1px solid var(--arc-border);border-radius:6px;background:var(--arc-bg-surface)}.section-title{display:flex;align-items:baseline;justify-content:space-between;gap:8px}.section-title span,.slot-hint{color:var(--arc-text-hint);font-size:11px}.slot-hint{margin:0;line-height:1.6}
.enable-warning{display:flex;align-items:center;justify-content:space-between;gap:10px}.enable-warning span{line-height:1.5}
.generation-summary{display:flex;align-items:flex-start;gap:10px;margin:2px 0 12px;padding:12px;border:1px solid color-mix(in srgb,var(--arc-primary) 35%,var(--arc-border));border-radius:10px;background:var(--arc-primary-soft);color:var(--arc-primary)}.generation-summary.warning{border-color:var(--arc-danger);color:var(--arc-danger)}.generation-summary svg{flex:none;margin-top:2px}.generation-summary div{display:flex;min-width:0;flex-direction:column;gap:3px}.generation-summary span{color:var(--arc-text-secondary);font-size:11px;line-height:1.5}
.preview-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.preview-head>div{display:flex;flex-direction:column;gap:2px}.preview-head strong{font-size:16px}.preview-head span{color:var(--arc-text-hint);font-size:11px}.preview-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;max-height:650px;overflow:auto;padding-right:3px}.equipment-card{min-width:0;padding:11px;border:1px solid var(--arc-border);border-radius:10px;background:var(--arc-bg-weak)}.equipment-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.equipment-card-head>div{display:flex;min-width:0;align-items:center;gap:6px}.equipment-card-head strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.equipment-card-head span{flex:none;color:#a47734;font-size:10px;font-weight:750}.equipment-card-head button{display:grid;place-items:center;width:26px;height:26px;flex:none;color:var(--arc-text-hint);border:0;border-radius:6px;background:transparent;cursor:pointer}.equipment-card-head button:hover{color:var(--arc-danger);background:var(--arc-bg-surface-hover)}.equipment-meta{display:flex;gap:8px;margin:7px 0;color:var(--arc-text-hint);font-size:10px}.equipment-bonus{color:var(--arc-primary)!important;font-weight:700}.equipment-card p{margin:4px 0 0;color:var(--arc-text-secondary);font-size:11px;line-height:1.5}
@media(max-width:960px){.generator-layout{grid-template-columns:1fr}.preview-card{min-height:360px}}@media(max-width:620px){.form-grid,.preview-list{grid-template-columns:1fr}.generator-hero h1{font-size:23px}}
</style>
