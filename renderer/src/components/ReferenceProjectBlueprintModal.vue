<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag,
  useMessage
} from 'naive-ui'
import type { ReferenceAssetLibrary } from '@/features/knowledge/knowledgeCenter'
import {
  createProjectWorkspaceSeedFromReferenceBlueprint,
  type ReferenceProjectBlueprintResult,
  type StoryConceptOption,
  type StoryConceptOptionsResult
} from '@/features/wizard/projectSeed'
import { PROJECT_GENRE_OPTIONS } from '@/features/wizard/projectGenres'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'

const props = defineProps<{
  show: boolean
  asset: ReferenceAssetLibrary | null
}>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()

const appStore = useAppStore()
const message = useMessage()
const generatingStage = ref<'concepts' | 'blueprint' | null>(null)
const generating = computed(() => generatingStage.value !== null)
const conceptResult = ref<StoryConceptOptionsResult | null>(null)
const selectedConceptId = ref('')
const conceptInputSignature = ref('')
const result = ref<ReferenceProjectBlueprintResult | null>(null)
const form = reactive({
  title: '',
  genre: '玄幻',
  volumeMode: 'auto' as 'auto' | 'manual',
  manualVolumePlan: '',
  premise: ''
})

const genreOptions = PROJECT_GENRE_OPTIONS
  .filter((option) => !option.isCustom)
  .map((option) => ({ label: option.label, value: option.label }))

watch(() => [props.show, props.asset?.id] as const, ([show]) => {
  if (!show || !props.asset) return
  form.title = ''
  form.genre = props.asset.topKeywords.find((keyword) =>
    genreOptions.some((option) => option.value === keyword)
  ) || '玄幻'
  form.volumeMode = 'auto'
  form.manualVolumePlan = ''
  form.premise = ''
  conceptResult.value = null
  selectedConceptId.value = ''
  conceptInputSignature.value = ''
  result.value = null
})

const selectedConcept = computed<StoryConceptOption | null>(() =>
  conceptResult.value?.options.find((option) => option.id === selectedConceptId.value) ?? null
)

const groupedOutline = computed(() => {
  if (!result.value) return []
  return result.value.outlineVolumes.map((volume, index) => ({
    ...volume,
    entries: result.value?.outlineItems.filter((item) => item.volumeIndex === index) ?? []
  }))
})

function close(): void {
  if (!generating.value) emit('update:show', false)
}

function currentConceptInputSignature(): string {
  return JSON.stringify({
    assetId: props.asset?.id ?? '',
    title: form.title.trim(),
    genre: form.genre,
    premise: form.premise.trim()
  })
}

watch(() => [form.title, form.genre, form.premise] as const, () => {
  if (!conceptResult.value || currentConceptInputSignature() === conceptInputSignature.value) return
  conceptResult.value = null
  selectedConceptId.value = ''
  conceptInputSignature.value = ''
  result.value = null
})

watch(() => [form.volumeMode, form.manualVolumePlan] as const, () => {
  result.value = null
})

function buildReferenceStructure(asset: ReferenceAssetLibrary, cap = 16_000): string {
  const work = appStore.referenceWorks.find((item) => item.id === asset.id)
  const analysis = work?.analysis
  const sections: string[] = []
  if (analysis?.overview) sections.push(`【拆书总述】\n${analysis.overview}`)
  if (analysis?.plotOutline) sections.push(`【抽象剧情骨架】\n${analysis.plotOutline}`)

  const priority = (title: string): number => {
    if (/主线|故事线|剧情骨架/u.test(title)) return 0
    if (/深度拆书总纲|整体拆书/u.test(title)) return 1
    if (/桥段拆解|黄金三章/u.test(title)) return 2
    if (/主角|角色/u.test(title)) return 3
    if (/设定|世界观/u.test(title)) return 4
    return 5
  }
  const documents = appStore.knowledgeDocuments
    .filter((document) => asset.relatedDocumentIds.includes(document.id))
    .filter((document) => !/作者风格指纹/u.test(document.title))
    .sort((left, right) => priority(left.title) - priority(right.title))

  let used = sections.join('\n\n').length
  for (const document of documents) {
    if (used >= cap) break
    const body = String(document.content || document.summary || '').trim().slice(0, 2_800)
    if (!body) continue
    const section = `【${document.title}】\n${body}`
    const remaining = cap - used
    sections.push(section.slice(0, remaining))
    used += Math.min(section.length, remaining)
  }
  return sections.join('\n\n')
}

function validateConceptInputs(): ReferenceAssetLibrary | null {
  const asset = props.asset
  if (!asset) return null
  if (!form.title.trim()) {
    message.warning('请先填写新小说名称。')
    return null
  }
  if (form.premise.trim().length < 12) {
    message.warning('请用至少 12 个字说明你的原创方向，AI 会在这个边界内提供不同思路。')
    return null
  }
  return asset
}

async function generateConceptOptions(): Promise<void> {
  const asset = validateConceptInputs()
  if (!asset) return
  const referenceStructure = buildReferenceStructure(asset, 8_000)
  if (!referenceStructure.trim()) {
    message.error('这部参考作品还没有可用的拆书大纲，请先完成拆书。')
    return
  }

  generatingStage.value = 'concepts'
  try {
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'story-concept-options',
      settings: appStore.appSettings,
      context: {
        referenceTitle: asset.title,
        referenceStructure,
        projectTitle: form.title.trim(),
        projectGenre: form.genre,
        projectPremise: form.premise.trim()
      }
    }))
    if (!response.success || !response.result) {
      throw new Error(response.error ?? '创意思路生成失败')
    }
    conceptResult.value = response.result as StoryConceptOptionsResult
    selectedConceptId.value = ''
    conceptInputSignature.value = currentConceptInputSignature()
    result.value = null
    message.success('已生成 4 条创意思路，请选择一条继续。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创意思路生成失败')
  } finally {
    generatingStage.value = null
  }
}

function selectConcept(id: string): void {
  if (generating.value) return
  selectedConceptId.value = id
  result.value = null
}

async function generateBlueprint(): Promise<void> {
  const asset = validateConceptInputs()
  if (!asset) return
  if (!selectedConcept.value) {
    message.warning('请先选择一条创意思路。')
    return
  }
  if (currentConceptInputSignature() !== conceptInputSignature.value) {
    message.warning('项目名称、题材或原创方向已变化，请重新生成创意思路。')
    return
  }
  if (form.volumeMode === 'manual' && !form.manualVolumePlan.trim()) {
    message.warning('手动分卷时，请至少填写一个卷名或阶段目标。')
    return
  }
  const referenceStructure = buildReferenceStructure(asset)
  if (!referenceStructure.trim()) {
    message.error('这部参考作品还没有可用的拆书大纲，请先完成拆书。')
    return
  }

  generatingStage.value = 'blueprint'
  try {
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'reference-project-blueprint',
      settings: appStore.appSettings,
      context: {
        referenceTitle: asset.title,
        referenceStructure,
        projectTitle: form.title.trim(),
        projectGenre: form.genre,
        projectVolumeMode: form.volumeMode,
        manualVolumePlan: form.manualVolumePlan.trim(),
        deepAnalysisCoverage: `${asset.deepAnalysisCoverage.completedCount}/${asset.deepAnalysisCoverage.totalCount}`,
        missingDeepAnalysisDimensions: asset.deepAnalysisCoverage.missingDimensions.map((item) => item.label),
        projectPremise: form.premise.trim(),
        lockedFacts: conceptResult.value?.lockedFacts ?? [],
        selectedConcept: selectedConcept.value
      }
    }))
    if (!response.success || !response.result) {
      throw new Error(response.error ?? '原创骨架生成失败')
    }
    result.value = response.result as ReferenceProjectBlueprintResult
    message.success('原创骨架已生成，请审阅后再创建项目。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '原创骨架生成失败')
  } finally {
    generatingStage.value = null
  }
}

function createProject(): void {
  const asset = props.asset
  if (!asset || !result.value) return
  const novelLength = result.value.outlineVolumes.length <= 1 ? 'short' : 'long'
  const seed = createProjectWorkspaceSeedFromReferenceBlueprint({
    title: form.title,
    genre: form.genre,
    novelLength,
    premise: result.value.blueprintSummary || form.premise,
    shouldGenerate: true
  }, result.value, [asset.id])
  appStore.createProjectWorkspace(seed)
  emit('update:show', false)
  message.success(`已创建《${form.title.trim()}》，参考作品也已绑定到新项目。`)
}
</script>

<template>
  <n-modal :show="show" :mask-closable="!generating" @update:show="emit('update:show', $event)">
    <n-card class="blueprint-modal" :bordered="false" role="dialog" aria-modal="true">
      <template #header>
        <div class="modal-title">
          <strong>基于拆书创建原创小说</strong>
          <span v-if="asset">结构参考：《{{ asset.title }}》</span>
        </div>
      </template>

      <div class="modal-body-scroll">
      <n-alert type="info" :show-icon="false">
        先根据你的原创方向生成 4 条不同路线；选定后才会借用拆书中的抽象节奏和桥段功能生成骨架。任何结果都不会立即创建项目。
      </n-alert>

      <div v-if="asset" class="coverage-summary">
        <div>
          <strong>深度拆书覆盖率</strong>
          <n-tag :type="asset.deepAnalysisCoverage.complete ? 'success' : asset.deepAnalysisCoverage.recommendedReady ? 'info' : 'warning'" size="small" :bordered="false">
            {{ asset.deepAnalysisCoverage.completedCount }}/{{ asset.deepAnalysisCoverage.totalCount }} · {{ asset.deepAnalysisCoverage.percent }}%
          </n-tag>
        </div>
        <p v-if="asset.deepAnalysisCoverage.complete">核心与增强维度齐全，适合生成较稳定的原创骨架。</p>
        <p v-else>
          基础拆书仍可创建；补充{{ asset.deepAnalysisCoverage.missingDimensions.map((item) => item.label).join('、') }}后，人物、节奏和世界规则会更稳定。
        </p>
      </div>

      <n-form label-placement="top" class="blueprint-form">
        <div class="form-grid">
          <n-form-item label="新小说名称">
            <n-input v-model:value="form.title" placeholder="例如：灰塔拾荒者" />
          </n-form-item>
          <n-form-item label="题材">
            <n-select v-model:value="form.genre" filterable tag :options="genreOptions" />
          </n-form-item>
        </div>
        <n-form-item label="分卷方式">
          <n-radio-group v-model:value="form.volumeMode">
            <n-radio-button value="auto">自动分卷</n-radio-button>
            <n-radio-button value="manual">手动分卷</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="form.volumeMode === 'manual'" label="分卷草案">
          <n-input
            v-model:value="form.manualVolumePlan"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 7 }"
            placeholder="每行一卷，可只写卷名，也可写“卷名｜本卷阶段目标”。不需要填写字数或预计章节数。"
          />
        </n-form-item>
        <n-form-item label="原创方向（必填）">
          <n-input
            v-model:value="form.premise"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="说明你真正想写的主角身份、核心冲突、世界差异或读者爽点。写得越具体，越不会接近参考作品。"
          />
        </n-form-item>
      </n-form>

      <div class="generate-row">
        <n-button type="primary" :loading="generatingStage === 'concepts'" :disabled="generatingStage === 'blueprint'" @click="generateConceptOptions">
          {{ conceptResult ? '重新生成 4 条思路' : '生成 4 条创意思路' }}
        </n-button>
        <span>不需要额外样本；拆书只作为结构参考，不读取整本原文。</span>
      </div>

      <section v-if="conceptResult" class="concept-review">
        <div class="review-heading">
          <strong>第一步 · 确认不能改动的事实</strong>
          <n-tag type="info" :bordered="false">来自你的原创方向</n-tag>
        </div>
        <div class="locked-facts">
          <n-tag v-for="fact in conceptResult.lockedFacts" :key="fact" :bordered="false">{{ fact }}</n-tag>
        </div>

        <div class="concept-heading">
          <strong>第二步 · 选择一条故事路线</strong>
          <span>四条路线共用上面的锁定事实，只改变故事如何发动和升级。</span>
        </div>
        <div class="concept-grid">
          <button
            v-for="option in conceptResult.options"
            :key="option.id"
            type="button"
            class="concept-card"
            :class="{ selected: selectedConceptId === option.id }"
            :aria-pressed="selectedConceptId === option.id"
            @click="selectConcept(option.id)"
          >
            <span class="concept-card-title">
              <strong>{{ option.title }}</strong>
              <n-tag
                size="small"
                :type="option.similarityRisk === 'low' ? 'success' : option.similarityRisk === 'high' ? 'error' : 'warning'"
                :bordered="false"
              >
                相似风险 {{ option.similarityRisk === 'low' ? '低' : option.similarityRisk === 'high' ? '高' : '中' }}
              </n-tag>
            </span>
            <b>{{ option.coreHook }}</b>
            <p>{{ option.logline }}</p>
            <span class="concept-detail"><em>冲突发动机</em>{{ option.conflictEngine }}</span>
            <span class="concept-detail"><em>成长方式</em>{{ option.growthEngine }}</span>
            <span class="concept-detail"><em>追读承诺</em>{{ option.longTermPromise }}</span>
            <ul>
              <li v-for="item in option.differentiators" :key="item">{{ item }}</li>
            </ul>
          </button>
        </div>

        <div class="generate-row blueprint-action">
          <n-button
            type="primary"
            :loading="generatingStage === 'blueprint'"
            :disabled="!selectedConcept || generatingStage === 'concepts'"
            @click="generateBlueprint"
          >
            {{ result ? '按已选路线重新生成骨架' : '基于已选路线生成骨架' }}
          </n-button>
          <span v-if="selectedConcept">已选择：{{ selectedConcept.title }}</span>
          <span v-else>请先点击选择一条路线。</span>
        </div>
      </section>

      <div v-if="result" class="review-scroll">
        <section class="review-section">
          <div class="review-heading">
            <strong>待确认 · 故事骨架</strong>
            <n-tag type="warning" :bordered="false">尚未创建项目</n-tag>
          </div>
          <p>{{ result.blueprintSummary }}</p>
        </section>

        <section class="review-section">
          <strong>原创化改造记录</strong>
          <ul>
            <li v-for="note in result.transformationNotes" :key="note">{{ note }}</li>
          </ul>
        </section>

        <section class="review-section">
          <strong>世界规则（{{ result.worldviewEntries.length }} 条）</strong>
          <div class="world-tags">
            <n-tag v-for="entry in result.worldviewEntries" :key="`${entry.type}-${entry.title}`" :bordered="false">
              {{ entry.type }} · {{ entry.title }}
            </n-tag>
          </div>
        </section>

        <n-collapse class="volume-review" accordion>
          <n-collapse-item
            v-for="(volume, index) in groupedOutline"
            :key="`${index}-${volume.title}`"
            :name="index"
            :title="`${volume.title} · ${volume.entries.length} 个节点 · ${volume.entries.reduce((count, entry) => count + Math.max(1, entry.chapterPlan?.length || 0), 0)} 章建议`"
          >
            <p class="volume-summary">{{ volume.summary }}</p>
            <ol class="beat-list">
              <li v-for="entry in volume.entries" :key="entry.title">
                <strong>{{ entry.title }}</strong>
                <span>{{ entry.conflict }}</span>
                <p>{{ entry.summary }}</p>
                <ol v-if="entry.chapterPlan?.length" class="chapter-plan-list">
                  <li v-for="chapter in entry.chapterPlan" :key="`${entry.title}-${chapter.title}`">
                    <b>{{ chapter.title }}</b>
                    <span>{{ chapter.conflict }}</span>
                    <p>{{ chapter.summary }}</p>
                  </li>
                </ol>
              </li>
            </ol>
          </n-collapse-item>
        </n-collapse>
      </div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <n-button :disabled="generating" @click="close">取消</n-button>
          <n-button type="primary" :disabled="!result || generating" @click="createProject">
            确认骨架并创建项目
          </n-button>
        </div>
      </template>
    </n-card>
  </n-modal>
</template>

<style scoped>
.blueprint-modal { width: min(1040px, 94vw); }
.modal-body-scroll { max-height: calc(92vh - 150px); overflow-y: auto; padding-right: 8px; }
.modal-title { display: flex; flex-direction: column; gap: 4px; }
.modal-title span, .generate-row span { color: var(--arc-text-tertiary); font-size: 12px; }
.blueprint-form { margin-top: 16px; }
.coverage-summary { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.coverage-summary > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.coverage-summary p { margin: 7px 0 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; }
.form-grid { display: grid; grid-template-columns: 1fr 220px; gap: 12px; }
.generate-row { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.concept-review { margin-bottom: 16px; padding: 14px; border: 1px solid var(--arc-border); border-radius: 12px; background: var(--arc-bg-weak); }
.locked-facts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.concept-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 18px; }
.concept-heading span { color: var(--arc-text-tertiary); font-size: 12px; }
.concept-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
.concept-card { padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; color: var(--arc-text-primary); background: var(--arc-bg-card); text-align: left; cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease, background .15s ease; }
.concept-card:hover { border-color: var(--arc-primary); }
.concept-card.selected { border-color: var(--arc-primary); background: color-mix(in srgb, var(--arc-primary) 9%, var(--arc-bg-card)); box-shadow: 0 0 0 2px color-mix(in srgb, var(--arc-primary) 18%, transparent); }
.concept-card-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.concept-card > b { display: block; margin-top: 10px; }
.concept-card > p { margin: 6px 0 10px; color: var(--arc-text-secondary); line-height: 1.6; }
.concept-card ul { margin: 8px 0 0; padding-left: 18px; color: var(--arc-text-tertiary); line-height: 1.6; }
.concept-detail { display: block; margin-top: 6px; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.55; }
.concept-detail em { margin-right: 6px; color: var(--arc-primary); font-style: normal; font-weight: 600; }
.blueprint-action { margin: 16px 0 0; }
.review-scroll { padding-right: 2px; }
.review-section { margin-bottom: 14px; padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; }
.chapter-plan-list { margin: 10px 0 2px; padding: 10px 12px 8px 32px; border-left: 3px solid var(--arc-primary); background: var(--arc-bg-weak); border-radius: 8px; }
.chapter-plan-list li { margin-bottom: 9px; }
.chapter-plan-list b { display: block; }
.chapter-plan-list span, .chapter-plan-list p { color: var(--arc-text-secondary); font-size: 12px; }
.review-section p { margin: 8px 0 0; line-height: 1.7; white-space: pre-wrap; }
.review-section ul { margin: 8px 0 0; padding-left: 20px; line-height: 1.7; }
.review-heading { display: flex; justify-content: space-between; gap: 12px; }
.world-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.volume-summary { color: var(--arc-text-secondary); line-height: 1.7; }
.beat-list { margin: 0; padding-left: 24px; }
.beat-list li { margin-bottom: 12px; }
.beat-list li > span { display: block; margin-top: 4px; color: var(--arc-text-secondary); }
.beat-list li > p { margin: 4px 0 0; color: var(--arc-text-tertiary); line-height: 1.6; }
.modal-footer { display: flex; justify-content: flex-end; gap: 10px; }
@media (max-width: 720px) { .form-grid, .concept-grid { grid-template-columns: 1fr; } }
</style>
