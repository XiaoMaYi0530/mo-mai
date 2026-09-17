<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Fingerprint, RefreshCw, Save } from 'lucide-vue-next'
import { NButton, NCard, NEmpty, NInputNumber, NSelect, NTag, useMessage } from 'naive-ui'
import {
  buildProjectStyleFingerprintContext,
  collectStyleFingerprintReferenceIds,
  normalizeStyleFingerprintBinding,
  type ProjectStyleFingerprintBinding
} from '@shared/style-fingerprint-binding'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
const message = useMessage()
const draft = ref<ProjectStyleFingerprintBinding>({ version: 1, primaryReferenceWorkId: '', primaryWeight: 100, auxiliary: [] })

const referenceOptions = computed(() => appStore.referenceWorks.map((work) => {
  const resolved = buildProjectStyleFingerprintContext({
    binding: { primaryReferenceWorkId: work.id, primaryWeight: 100, auxiliary: [] },
    referenceWorks: appStore.referenceWorks,
    documents: appStore.knowledgeDocuments
  }).entries[0]
  return { label: `${work.title} · ${resolved?.status === 'ready' ? '已提取' : '未提取'}`, value: work.id }
}))
const auxiliaryOptions = computed(() => referenceOptions.value.filter((option) => option.value !== draft.value.primaryReferenceWorkId))
const selectedAuxiliaryIds = computed({
  get: () => draft.value.auxiliary.map((item) => item.referenceWorkId),
  set: (ids: string[]) => {
    const previous = new Map(draft.value.auxiliary.map((item) => [item.referenceWorkId, item.weight]))
    const remaining = ids.length ? 20 : 0
    const defaultWeight = ids.length ? Math.max(1, Math.round(remaining / ids.length)) : 0
    draft.value = {
      ...draft.value,
      primaryWeight: ids.length ? (draft.value.primaryWeight === 100 ? 80 : draft.value.primaryWeight) : 100,
      auxiliary: ids.map((referenceWorkId) => ({ referenceWorkId, weight: previous.get(referenceWorkId) ?? defaultWeight }))
    }
  }
})
const resolved = computed(() => buildProjectStyleFingerprintContext({
  binding: draft.value,
  referenceWorks: appStore.referenceWorks,
  documents: appStore.knowledgeDocuments
}))
const totalWeight = computed(() => draft.value.primaryWeight + draft.value.auxiliary.reduce((sum, item) => sum + item.weight, 0))

watch(
  () => [appStore.currentProject?.id, appStore.currentProject?.styleFingerprintBinding, appStore.currentProject?.selectedReferenceWorkIds] as const,
  () => {
    const project = appStore.currentProject
    draft.value = normalizeStyleFingerprintBinding(project?.styleFingerprintBinding, project?.selectedReferenceWorkIds)
  },
  { immediate: true, deep: true }
)

function setPrimary(referenceWorkId: string | null): void {
  const nextId = referenceWorkId ?? ''
  draft.value = normalizeStyleFingerprintBinding({
    ...draft.value,
    primaryReferenceWorkId: nextId,
    auxiliary: draft.value.auxiliary.filter((item) => item.referenceWorkId !== nextId)
  })
}

function updateAuxiliaryWeight(referenceWorkId: string, weight: number | null): void {
  draft.value = {
    ...draft.value,
    auxiliary: draft.value.auxiliary.map((item) => item.referenceWorkId === referenceWorkId
      ? { ...item, weight: Math.max(1, Math.min(100, Math.round(weight ?? 1))) }
      : item)
  }
}

function resetBinding(): void {
  draft.value = { version: 1, primaryReferenceWorkId: '', primaryWeight: 100, auxiliary: [] }
}

function saveBinding(): void {
  const project = appStore.currentProject
  if (!project) return
  const normalized = normalizeStyleFingerprintBinding(draft.value)
  const referenced = collectStyleFingerprintReferenceIds(normalized)
  appStore.updateProject(project.id, {
    styleFingerprintBinding: normalized,
    selectedReferenceWorkIds: [...new Set([...project.selectedReferenceWorkIds, ...referenced])]
  })
  draft.value = normalized
  message.success('项目风格指纹已保存，正文生成与润色将统一使用该绑定')
}

function workTitle(id: string): string {
  return appStore.referenceWorks.find((work) => work.id === id)?.title ?? '已删除的参考作品'
}

function workSource(id: string): string {
  const work = appStore.referenceWorks.find((item) => item.id === id)
  return [work?.source, work?.fileName].map((value) => value?.trim()).filter(Boolean).join(' · ') || '拆书知识库'
}

function formatTime(value?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <n-card class="fingerprint-card" :bordered="false">
    <template #header>
      <div class="card-title"><Fingerprint :size="19" /><span>项目风格指纹</span></div>
    </template>
    <template #header-extra>
      <n-tag size="small" :type="resolved.entries.some((entry) => entry.status === 'ready') ? 'success' : 'default'">
        {{ resolved.entries.some((entry) => entry.status === 'ready') ? '已启用' : '未启用' }}
      </n-tag>
    </template>

    <p class="intro">绑定属于当前项目。正文生成、整章润色和章节修复会自动使用；拆书库只负责提取，不会因临时勾选参考作品而混入文风。</p>

    <n-empty v-if="referenceOptions.length === 0" description="拆书库还没有参考作品">
      <template #extra><n-button @click="appStore.setPanel('deconstruction')">前往拆书知识库</n-button></template>
    </n-empty>
    <div v-else class="form-grid">
      <label>主风格指纹</label>
      <n-select
        :value="draft.primaryReferenceWorkId || null"
        :options="referenceOptions"
        clearable
        placeholder="选择一部参考作品"
        @update:value="setPrimary"
      />

      <template v-if="draft.primaryReferenceWorkId">
        <label>辅助风格指纹</label>
        <n-select v-model:value="selectedAuxiliaryIds" :options="auxiliaryOptions" multiple clearable placeholder="可选，多选后默认共占 20%" />

        <div class="weights-heading">
          <strong>混合权重</strong>
          <span>按相对值计算，当前合计 {{ totalWeight }}</span>
        </div>
        <div class="weight-row primary-row">
          <span>主 · {{ workTitle(draft.primaryReferenceWorkId) }}</span>
          <n-input-number v-model:value="draft.primaryWeight" :min="1" :max="100" :show-button="false"><template #suffix>%</template></n-input-number>
        </div>
        <div v-for="item in draft.auxiliary" :key="item.referenceWorkId" class="weight-row">
          <span>辅 · {{ workTitle(item.referenceWorkId) }}</span>
          <n-input-number :value="item.weight" :min="1" :max="100" :show-button="false" @update:value="updateAuxiliaryWeight(item.referenceWorkId, $event)"><template #suffix>%</template></n-input-number>
        </div>

        <div class="status-list">
          <div v-for="entry in resolved.entries" :key="entry.referenceWorkId" class="status-row">
            <div>
              <strong>{{ entry.role === 'primary' ? '主风格' : '辅助风格' }} · {{ entry.title }}</strong>
              <small>来源：{{ workSource(entry.referenceWorkId) }} · 提取时间：{{ formatTime(entry.extractedAt) }}</small>
            </div>
            <n-tag size="small" :type="entry.status === 'ready' ? 'success' : 'warning'">
              {{ entry.status === 'ready' ? `已提取 · 生效 ${entry.effectiveWeight}%` : '未提取' }}
            </n-tag>
          </div>
        </div>
        <p v-for="warning in resolved.warnings" :key="warning" class="warning">{{ warning }}</p>
      </template>
    </div>

    <div class="actions">
      <n-button secondary @click="appStore.setPanel('deconstruction')">管理与提取</n-button>
      <n-button quaternary :disabled="!draft.primaryReferenceWorkId" @click="resetBinding"><template #icon><RefreshCw /></template>清除绑定</n-button>
      <n-button type="primary" @click="saveBinding"><template #icon><Save /></template>保存项目绑定</n-button>
    </div>
  </n-card>
</template>

<style scoped>
.fingerprint-card { margin-top: 16px; background: var(--ca-surface-muted, #f7f9fc); }
.card-title { display: flex; align-items: center; gap: 8px; }
.intro { margin: 0 0 18px; color: var(--ca-text-secondary, #737b8c); line-height: 1.7; }
.form-grid { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 14px 18px; align-items: center; }
.form-grid > label { font-weight: 600; }
.weights-heading, .status-list, .warning { grid-column: 1 / -1; }
.weights-heading { display: flex; justify-content: space-between; margin-top: 4px; }
.weights-heading span, small { color: var(--ca-text-secondary, #7c8492); }
.weight-row { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) 110px; align-items: center; gap: 16px; padding: 10px 12px; border: 1px solid var(--ca-border, #e3e7ee); border-radius: 10px; background: var(--ca-surface, #fff); }
.primary-row { border-color: rgba(24, 160, 88, .35); }
.status-list { display: grid; gap: 8px; margin-top: 4px; }
.status-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; border-radius: 10px; background: var(--ca-surface, #fff); }
.status-row div { display: grid; gap: 4px; min-width: 0; }
.warning { margin: -4px 0 0; color: #d98614; }
.actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
@media (max-width: 760px) { .form-grid { grid-template-columns: 1fr; } .form-grid > * { grid-column: 1; } .status-row { align-items: flex-start; } }
</style>
