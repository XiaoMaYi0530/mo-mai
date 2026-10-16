import { computed, reactive, ref, toRaw, watch, nextTick, onBeforeUnmount } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import type { ReferenceAssetLibrary } from '@/features/knowledge/knowledgeCenter'
import {
  createProjectWorkspaceSeedFromReferenceDirect,
  createProjectWorkspaceSeedFromReferenceBlueprint,
  type ReferenceProjectBlueprintResult,
  type StoryConceptOption,
  type StoryConceptOptionsResult
} from '@/features/wizard/projectSeed'
import { creationDraftKey, readCreationDraft, writeCreationDraft } from '@/features/wizard/localCreationDraft'
import type { NovelLength } from '@/types/app'
import { PROJECT_GENRE_OPTIONS } from '@/features/wizard/projectGenres'
import { useAppStore } from '@/stores/app'
import { toIpcPayload } from '@/utils/ipcPayload'
import { applyBlueprintRevision, type BlueprintRevisionEdit, type BlueprintRevisionResult } from '@/features/wizard/referenceBlueprintRevision'

export interface ReferenceCreationProps { show: boolean; asset: ReferenceAssetLibrary | null; availableAssets: ReferenceAssetLibrary[] }
export function useReferenceProjectCreation(props: ReferenceCreationProps, emit: (event: 'update:show', value: boolean) => void) {

const appStore = useAppStore()
const message = useMessage()
const dialog = useDialog()
const generatingStage = ref<'concepts' | 'blueprint' | null>(null)
const generating = computed(() => generatingStage.value !== null)
const conceptResult = ref<StoryConceptOptionsResult | null>(null)
const selectedConceptId = ref('')
const conceptInputSignature = ref('')
const result = ref<ReferenceProjectBlueprintResult | null>(null)
const editingBlueprint = ref(false)
const blueprintBeforeEdit = ref<ReferenceProjectBlueprintResult | null>(null)
type RevisionMessage = { role: 'user' | 'assistant'; content: string }
const revisionMessages = ref<RevisionMessage[]>([])
const revisionInput = ref('')
const revisionBusy = ref(false)
const revisionProposal = ref<{ reply: string; edits: BlueprintRevisionEdit[]; draft: ReferenceProjectBlueprintResult } | null>(null)
const creationMode = ref<'blueprint' | 'direct'>('blueprint')
const directNovelLength = ref<NovelLength>('long')
const reuseCurrentWorldview = ref(false)
const sourceProject = computed(() => appStore.projects.find((project) => project.id === appStore.selectedProjectId) ?? null)
const sourceWorldviewEntries = computed(() => sourceProject.value ? appStore.worldviewEntries : [])
type ReferencePurpose = 'pacing' | 'plot' | 'relationships' | 'world'
const purposeOptions = [
  { label: '叙事节奏', value: 'pacing' },
  { label: '冲突与桥段', value: 'plot' },
  { label: '人物关系', value: 'relationships' },
  { label: '世界规则', value: 'world' }
]
const referencePlan = reactive({
  mainPurpose: 'pacing' as ReferencePurpose,
  auxiliaries: [
    { id: '', purpose: 'relationships' as ReferencePurpose },
    { id: '', purpose: 'world' as ReferencePurpose }
  ],
  bindStyle: false,
  styleReferenceId: ''
})
const auxiliaryAssetOptions = computed(() => props.availableAssets
  .filter((candidate) => candidate.id !== props.asset?.id)
  .map((candidate) => ({ label: `《${candidate.title}》`, value: candidate.id })))
const selectedReferences = computed(() => {
  if (!props.asset) return []
  return [
    { asset: props.asset, purpose: referencePlan.mainPurpose, role: '主参考' },
    ...referencePlan.auxiliaries.flatMap((entry, index) => {
      const asset = props.availableAssets.find((candidate) => candidate.id === entry.id)
      return asset ? [{ asset, purpose: entry.purpose, role: `辅助参考 ${index + 1}` }] : []
    })
  ]
})
const styleReferenceOptions = computed(() => selectedReferences.value
  .filter(({ asset }) => appStore.referenceWorks.some((work) => work.id === asset.id))
  .map(({ asset }) => ({ label: `《${asset.title}》`, value: asset.id })))
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

const draftKey = ref('')
const draftSavedAt = ref('')
const restoredDraft = ref(false)
let restoringDraft = false
let completedDraft = false
let draftTimer: ReturnType<typeof setTimeout> | undefined
function draftSnapshot() {
  return { form: { ...form }, referencePlan: toIpcPayload(referencePlan), conceptResult: conceptResult.value,
    selectedConceptId: selectedConceptId.value, conceptInputSignature: conceptInputSignature.value,
    result: result.value, editingBlueprint: editingBlueprint.value, blueprintBeforeEdit: blueprintBeforeEdit.value,
    revisionMessages: revisionMessages.value, revisionInput: revisionInput.value, revisionProposal: revisionProposal.value,
    creationMode: creationMode.value, directNovelLength: directNovelLength.value, reuseCurrentWorldview: reuseCurrentWorldview.value }
}
function saveCreationDraft() {
  clearTimeout(draftTimer)
  if (!draftKey.value || restoringDraft || completedDraft) return
  try { draftSavedAt.value = writeCreationDraft(localStorage, draftKey.value, draftSnapshot()) }
  catch { message.warning('创建草稿保存失败，请勿关闭窗口；可释放本机存储后重试。') }
}
function clearCompletedDraft() {
  completedDraft = true
  clearTimeout(draftTimer)
  try { localStorage.removeItem(draftKey.value) } catch { /* Project creation already succeeded. */ }
}
async function resetCreationDraft() {
  restoringDraft = true
  form.title = ''
  form.genre = props.asset?.topKeywords.find((keyword) =>
    genreOptions.some((option) => option.value === keyword)
  ) || '玄幻'
  form.volumeMode = 'auto'
  form.manualVolumePlan = ''
  form.premise = ''
  referencePlan.mainPurpose = 'pacing'
  referencePlan.auxiliaries[0] = { id: '', purpose: 'relationships' }
  referencePlan.auxiliaries[1] = { id: '', purpose: 'world' }
  referencePlan.bindStyle = false
  referencePlan.styleReferenceId = ''
  conceptResult.value = null
  selectedConceptId.value = ''
  conceptInputSignature.value = ''
  result.value = null
  editingBlueprint.value = false
  blueprintBeforeEdit.value = null
  revisionMessages.value = []
  revisionInput.value = ''
  revisionProposal.value = null
  creationMode.value = 'blueprint'
  directNovelLength.value = 'long'
  reuseCurrentWorldview.value = sourceWorldviewEntries.value.length > 0
  restoredDraft.value = false
  await nextTick()
  restoringDraft = false
}
watch(() => [props.show, props.asset?.id] as const, async ([show]) => {
  if (!show) { saveCreationDraft(); return }
  if (!props.asset) return
  saveCreationDraft()
  draftKey.value = creationDraftKey(appStore.selectedProjectId, props.asset.id)
  completedDraft = false
  await resetCreationDraft()
  const stored = readCreationDraft<ReturnType<typeof draftSnapshot>>(localStorage, draftKey.value)
  if (stored) {
    restoringDraft = true
    const data = stored.data
    Object.assign(form, data.form)
    Object.assign(referencePlan, data.referencePlan)
    conceptResult.value = data.conceptResult
    selectedConceptId.value = data.selectedConceptId
    conceptInputSignature.value = data.conceptInputSignature
    result.value = data.result
    editingBlueprint.value = data.editingBlueprint
    blueprintBeforeEdit.value = data.blueprintBeforeEdit
    revisionMessages.value = data.revisionMessages ?? []
    revisionInput.value = data.revisionInput ?? ''
    revisionProposal.value = data.revisionProposal
    creationMode.value = data.creationMode
    directNovelLength.value = data.directNovelLength
    reuseCurrentWorldview.value = data.reuseCurrentWorldview
    draftSavedAt.value = stored.savedAt
    restoredDraft.value = true
    await nextTick()
    restoringDraft = false
  }
}, { immediate: true })
watch(draftSnapshot, () => {
  if (!props.show || restoringDraft || completedDraft) return
  clearTimeout(draftTimer)
  draftTimer = setTimeout(saveCreationDraft, 250)
}, { deep: true })
window.addEventListener('beforeunload', saveCreationDraft)
onBeforeUnmount(() => { saveCreationDraft(); window.removeEventListener('beforeunload', saveCreationDraft) })
async function startFreshDraft() {
  if (generating.value || revisionBusy.value) return
  dialog.warning({ title: '重新开始创建', content: '当前创建草稿及未采纳的修改会被清空。',
    positiveText: '重新开始', negativeText: '保留草稿', onPositiveClick: async () => {
      await resetCreationDraft()
      saveCreationDraft()
    } })
}

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
  if (!generating.value && !revisionBusy.value) emit('update:show', false)
}

function currentConceptInputSignature(): string {
  return JSON.stringify({
    references: selectedReferences.value.map(({ asset, purpose }) => [asset.id, purpose]),
    title: form.title.trim(),
    genre: form.genre,
    premise: form.premise.trim()
  })
}

watch(() => currentConceptInputSignature(), () => {
  if (restoringDraft || !conceptResult.value || currentConceptInputSignature() === conceptInputSignature.value) return
  conceptResult.value = null
  selectedConceptId.value = ''
  conceptInputSignature.value = ''
  result.value = null
  editingBlueprint.value = false
  blueprintBeforeEdit.value = null
  revisionProposal.value = null
})

watch(() => [form.volumeMode, form.manualVolumePlan] as const, () => {
  if (restoringDraft) return
  result.value = null
  editingBlueprint.value = false
  blueprintBeforeEdit.value = null
  revisionProposal.value = null
})

function startEditingBlueprint(): void {
  if (!result.value || generating.value || revisionProposal.value) return
  blueprintBeforeEdit.value = structuredClone(toRaw(result.value))
  editingBlueprint.value = true
}

function cancelEditingBlueprint(): void {
  if (blueprintBeforeEdit.value) result.value = blueprintBeforeEdit.value
  blueprintBeforeEdit.value = null
  editingBlueprint.value = false
}

function validateBlueprint(blueprint: ReferenceProjectBlueprintResult): string | null {
  if (!blueprint.outlineVolumes.length) return '至少保留一个分卷。'
  for (const [index, volume] of blueprint.outlineVolumes.entries()) {
    if (!volume.title.trim() || !volume.summary.trim()) return `第 ${index + 1} 卷需要填写卷名和阶段目标。`
  }
  if (!blueprint.outlineItems.some((item) => item.volumeIndex === 0)) return '首卷至少保留一个剧情节点。'
  if (!blueprint.outlineItems.some((item) => item.volumeIndex === 0 && (item.chapterPlan?.length ?? 0) > 0)) {
    return '首卷至少保留一个章节建议。'
  }
  for (const [index, item] of blueprint.outlineItems.entries()) {
    if (!item.title?.trim() || !item.conflict?.trim() || !item.summary?.trim()) {
      return `第 ${index + 1} 个剧情节点需要填写标题、冲突和摘要。`
    }
    for (const [chapterIndex, chapter] of (item.chapterPlan ?? []).entries()) {
      if (!chapter.title?.trim() || !chapter.conflict?.trim() || !chapter.summary?.trim()) {
        return `「${item.title}」的第 ${chapterIndex + 1} 个章节建议需要填写标题、冲突和摘要。`
      }
    }
  }
  return null
}

function saveEditingBlueprint(): void {
  if (!result.value) return
  const error = validateBlueprint(result.value)
  if (error) {
    message.warning(error)
    return
  }
  blueprintBeforeEdit.value = null
  editingBlueprint.value = false
  message.success('骨架修改已保留，确认后将按此版本创建项目。')
}

function addOutlineItem(volumeIndex: number): void {
  if (!result.value) return
  const items = result.value.outlineItems
  let lastIndex = -1
  for (let index = 0; index < items.length; index += 1) {
    if (items[index].volumeIndex === volumeIndex) lastIndex = index
  }
  const nextVolumeIndex = items.findIndex((item) => item.volumeIndex > volumeIndex)
  const insertionIndex = lastIndex >= 0 ? lastIndex + 1 : nextVolumeIndex >= 0 ? nextVolumeIndex : items.length
  items.splice(insertionIndex, 0, {
    volumeIndex,
    title: '',
    conflict: '',
    summary: '',
    chapterPlan: volumeIndex === 0 ? [{ title: '', conflict: '', summary: '' }] : []
  })
}

function removeOutlineItem(item: ReferenceProjectBlueprintResult['outlineItems'][number]): void {
  if (!result.value) return
  const index = result.value.outlineItems.indexOf(item)
  if (index >= 0) result.value.outlineItems.splice(index, 1)
}

function addChapterPlan(item: ReferenceProjectBlueprintResult['outlineItems'][number]): void {
  item.chapterPlan ??= []
  item.chapterPlan.push({ title: '', conflict: '', summary: '' })
}

function removeChapterPlan(item: ReferenceProjectBlueprintResult['outlineItems'][number], index: number): void {
  item.chapterPlan?.splice(index, 1)
}

async function sendRevisionRequest(): Promise<void> {
  if (!result.value || revisionBusy.value || revisionProposal.value || editingBlueprint.value) return
  const instruction = revisionInput.value.trim()
  if (!instruction) return
  const baseline = result.value
  const inputSignature = currentConceptInputSignature()
  const source = structuredClone(toRaw(result.value))
  revisionMessages.value.push({ role: 'user', content: instruction })
  revisionInput.value = ''
  revisionBusy.value = true
  try {
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'reference-blueprint-revise',
      settings: appStore.appSettings,
      context: {
        projectTitle: form.title.trim(),
        projectPremise: form.premise.trim(),
        selectedConcept: selectedConcept.value,
        blueprint: source,
        messages: revisionMessages.value.slice(-8)
      }
    }))
    if (!response.success || !response.result) throw new Error(response.error ?? 'AI 修改骨架失败')
    if (result.value !== baseline || currentConceptInputSignature() !== inputSignature) return
    const proposal = response.result as BlueprintRevisionResult
    if (!proposal.reply?.trim()) throw new Error('AI 未返回有效的修改说明')
    revisionMessages.value.push({ role: 'assistant', content: proposal.reply.trim() })
    if (!proposal.edits?.length) return
    const draft = applyBlueprintRevision(source, proposal.edits)
    const error = validateBlueprint(draft)
    if (error) throw new Error(`AI 修改稿不完整：${error}`)
    revisionProposal.value = { reply: proposal.reply.trim(), edits: proposal.edits, draft }
  } catch (error) {
    revisionInput.value = instruction
    message.error(error instanceof Error ? error.message : 'AI 修改骨架失败')
  } finally {
    revisionBusy.value = false
  }
}

function adoptRevision(): void {
  if (!revisionProposal.value) return
  result.value = revisionProposal.value.draft
  revisionProposal.value = null
  message.success('已采用 AI 修改稿，可继续对话修改或创建项目。')
}

function discardRevision(): void {
  revisionProposal.value = null
  message.info('已放弃这次 AI 修改稿。')
}

function revisionEditLabel(edit: BlueprintRevisionEdit): string {
  const position = `第 ${edit.volumeIndex + 1} 卷`
    + (edit.target === 'volume' ? '' : ` · 节点 ${(edit.nodeIndex ?? 0) + 1}`)
    + (edit.target === 'chapter' ? ` · 章节 ${(edit.chapterIndex ?? 0) + 1}` : '')
  const action = { update: '修改', insert: '新增', delete: '删除' }[edit.action]
  return `${action}${position}`
}

function revisionExistingTitle(edit: BlueprintRevisionEdit): string {
  if (!result.value || edit.action === 'insert') return ''
  if (edit.target === 'volume') return result.value.outlineVolumes[edit.volumeIndex]?.summary ?? ''
  const node = result.value.outlineItems.filter((item) => item.volumeIndex === edit.volumeIndex)[edit.nodeIndex ?? -1]
  if (edit.target === 'node') return node?.title ?? ''
  return node?.chapterPlan?.[edit.chapterIndex ?? -1]?.title ?? ''
}

function buildReferenceStructure(asset: ReferenceAssetLibrary, purpose: ReferencePurpose, cap: number): string {
  const work = appStore.referenceWorks.find((item) => item.id === asset.id)
  const analysis = work?.analysis
  const sections: string[] = []
  if ((purpose === 'plot' || purpose === 'pacing') && analysis?.plotOutline) {
    sections.push(`【抽象剧情骨架】\n${analysis.plotOutline}`.slice(0, cap))
  }
  const patterns: Record<ReferencePurpose, RegExp> = {
    pacing: /节奏|开篇|黄金三章|信息释放|悬念|钩子|主线/u,
    plot: /桥段|冲突|主线|故事线|剧情/u,
    relationships: /人物|角色|关系|主角|配角/u,
    world: /世界|设定|规则|体系|势力/u
  }
  const documents = appStore.knowledgeDocuments
    .filter((document) => asset.relatedDocumentIds.includes(document.id))
    .filter((document) => !/作者风格指纹/u.test(document.title))
    .filter((document) => patterns[purpose].test(document.title))

  let used = sections.join('\n\n').length
  for (const document of documents) {
    if (used >= cap) break
    const body = String(document.content || document.summary || '').trim().slice(0, 2_000)
    if (!body) continue
    const section = `【${document.title}】\n${body}`
    const remaining = cap - used
    sections.push(section.slice(0, remaining))
    used += Math.min(section.length, remaining)
  }
  return sections.join('\n\n')
}

function buildReferenceSources(cap: number): Array<{ title: string; role: string; purpose: string; findings: string }> {
  return selectedReferences.value.map(({ asset, purpose, role }) => ({
    title: asset.title,
    role,
    purpose: purposeOptions.find((option) => option.value === purpose)?.label ?? purpose,
    findings: buildReferenceStructure(asset, purpose, cap)
  }))
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
  const selectedIds = selectedReferences.value.map(({ asset: selected }) => selected.id)
  if (new Set(selectedIds).size !== selectedIds.length) {
    message.warning('同一本作品只能担任一个参考角色。')
    return null
  }
  return asset
}

async function generateConceptOptions(): Promise<void> {
  const asset = validateConceptInputs()
  if (!asset) return
  const referenceSources = buildReferenceSources(3_000)
  if (referenceSources.some((source) => !source.findings.trim())) {
    message.error('所选参考作品缺少对应用途的拆书结论，请换用途或先补充拆书。')
    return
  }

  const inputSignature = currentConceptInputSignature()
  generatingStage.value = 'concepts'
  try {
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'story-concept-options',
      settings: appStore.appSettings,
      context: {
        referenceSources,
        projectTitle: form.title.trim(),
        projectGenre: form.genre,
        projectPremise: form.premise.trim()
      }
    }))
    if (!response.success || !response.result) {
      throw new Error(response.error ?? '创意思路生成失败')
    }
    if (currentConceptInputSignature() !== inputSignature) return
    conceptResult.value = response.result as StoryConceptOptionsResult
    selectedConceptId.value = ''
    conceptInputSignature.value = inputSignature
    result.value = null
    message.success('已生成 4 条创意思路，请选择一条继续。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '创意思路生成失败')
  } finally {
    generatingStage.value = null
  }
}

function selectConcept(id: string): void {
  if (generating.value || editingBlueprint.value) return
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
  const referenceSources = buildReferenceSources(5_000)
  if (referenceSources.some((source) => !source.findings.trim())) {
    message.error('所选参考作品缺少对应用途的拆书结论，请换用途或先补充拆书。')
    return
  }

  const inputSignature = currentConceptInputSignature()
  const volumeSignature = JSON.stringify([form.volumeMode, form.manualVolumePlan])
  generatingStage.value = 'blueprint'
  try {
    const response = await window.characterArc.generateAi(toIpcPayload({
      task: 'reference-project-blueprint',
      settings: appStore.appSettings,
      context: {
        referenceSources,
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
    if (currentConceptInputSignature() !== inputSignature
      || JSON.stringify([form.volumeMode, form.manualVolumePlan]) !== volumeSignature
      || !selectedConcept.value) return
    result.value = response.result as ReferenceProjectBlueprintResult
    editingBlueprint.value = false
    blueprintBeforeEdit.value = null
    revisionMessages.value = []
    revisionProposal.value = null
    message.success('原创骨架已生成，请审阅后再创建项目。')
  } catch (error) {
    message.error(error instanceof Error ? error.message : '原创骨架生成失败')
  } finally {
    generatingStage.value = null
  }
}

function createProject(): void {
  const asset = props.asset
  if (!asset || !result.value || editingBlueprint.value || revisionBusy.value || revisionProposal.value) return
  const blueprintError = validateBlueprint(result.value)
  if (blueprintError) {
    message.warning(blueprintError)
    return
  }
  if (new Set(selectedReferences.value.map((entry) => entry.asset.id)).size !== selectedReferences.value.length) {
    message.warning('同一本作品只能担任一个参考角色。')
    return
  }
  if (referencePlan.bindStyle && !styleReferenceOptions.value.some((option) => option.value === referencePlan.styleReferenceId)) {
    message.warning('请选择一本文风来源。')
    return
  }
  const novelLength = result.value.outlineVolumes.length <= 1 ? 'short' : 'long'
  const seed = createProjectWorkspaceSeedFromReferenceBlueprint({
    title: form.title,
    genre: form.genre,
    novelLength,
    premise: result.value.blueprintSummary || form.premise,
    shouldGenerate: true
  }, result.value, selectedReferences.value.map(({ asset: selected }) => selected.id),
  referencePlan.bindStyle ? referencePlan.styleReferenceId : '')
  appStore.createProjectWorkspace(seed)
  clearCompletedDraft()
  emit('update:show', false)
  message.success(`已创建《${form.title.trim()}》，结构参考已保存。`)
}

function createDirectProject(): void {
  if (!props.asset || generating.value || revisionBusy.value) return
  if (!form.title.trim()) {
    message.warning('请先填写新小说名称。')
    return
  }
  if (new Set(selectedReferences.value.map((entry) => entry.asset.id)).size !== selectedReferences.value.length) {
    message.warning('同一本作品只能担任一个参考角色。')
    return
  }
  if (referencePlan.bindStyle && !styleReferenceOptions.value.some((option) => option.value === referencePlan.styleReferenceId)) {
    message.warning('请选择一本文风来源。')
    return
  }
  const worldviews = reuseCurrentWorldview.value ? [...sourceWorldviewEntries.value] : []
  const seed = createProjectWorkspaceSeedFromReferenceDirect({
    title: form.title,
    genre: form.genre,
    novelLength: directNovelLength.value,
    premise: form.premise,
    shouldGenerate: false
  }, worldviews, selectedReferences.value.map(({ asset }) => asset.id),
  referencePlan.bindStyle ? referencePlan.styleReferenceId : '')
  appStore.createProjectWorkspace(seed)
  clearCompletedDraft()
  emit('update:show', false)
  message.success(`已创建《${form.title.trim()}》，复制 ${worldviews.length} 条世界观设定；剧情骨架留空。`)
}

return { generatingStage, generating, conceptResult, selectedConceptId, result, editingBlueprint, revisionMessages, revisionInput, revisionBusy, revisionProposal, creationMode, directNovelLength, reuseCurrentWorldview, sourceProject, sourceWorldviewEntries, purposeOptions, referencePlan, auxiliaryAssetOptions, styleReferenceOptions, form, genreOptions, draftSavedAt, restoredDraft, startFreshDraft, selectedConcept, groupedOutline, close, startEditingBlueprint, cancelEditingBlueprint, saveEditingBlueprint, addOutlineItem, removeOutlineItem, addChapterPlan, removeChapterPlan, sendRevisionRequest, adoptRevision, discardRevision, revisionEditLabel, revisionExistingTitle, generateConceptOptions, selectConcept, generateBlueprint, createProject, createDirectProject }
}
