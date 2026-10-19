<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NModal, NCard, NButton, NSelect, useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { getPlainTextFromEditorContent } from '@/features/chapters/editorContent'
import { copyBackupProjectChapters, type BackupCatalog } from '@shared/backup-preview'
const props = defineProps<{ show: boolean; name: string }>()
const emit = defineEmits<{ 'update:show': [value: boolean]; restoreAll: [] }>()
const store = useAppStore(), message = useMessage()
const catalog = ref<BackupCatalog>({ projects: [] })
const sourceId = ref(''), selectedIds = ref<string[]>([]), previewId = ref(''), content = ref(''), error = ref('')
const targetId = ref(''), volumeId = ref(''), busy = ref(false), loading = ref(false), reading = ref(false)
const pending = ref<{ projectId: string; count: number; open: boolean } | null>(null)
const source = computed(() => catalog.value.projects.find(p => p.id === sourceId.value))
const targetVolumes = computed(() => store.getProjectVolumes(targetId.value))
watch(targetId, () => { volumeId.value = targetVolumes.value[0]?.id ?? '' })
watch(sourceId, () => { selectedIds.value = []; previewId.value = ''; content.value = '' })
let loadToken = 0, previewToken = 0
watch(() => [props.show, props.name], async () => {
  const token = ++loadToken
  ++previewToken; content.value = ''; reading.value = false
  if (!props.show) return
  if (pending.value && !store.persistenceError && !store.isPersistencePending && !store.isPersisting) pending.value = null
  if (pending.value) return
  catalog.value = { projects: [] }; selectedIds.value = []; sourceId.value = ''; error.value = ''; pending.value = null
  targetId.value = store.selectedProjectId; volumeId.value = targetVolumes.value[0]?.id ?? ''; loading.value = true
  try {
    const response = await window.characterArc.previewWorkspaceBackup(props.name)
    if (token !== loadToken) return
    if (!response.success || !response.result) throw new Error(response.error || '无法预览备份')
    catalog.value = response.result; sourceId.value = response.result.projects[0]?.id ?? ''
  } catch (e) { if (token === loadToken) error.value = String(e) }
  finally { if (token === loadToken) loading.value = false }
})
watch(previewId, async id => {
  const token = ++previewToken
  content.value = ''; error.value = ''; reading.value = false
  if (!id) return
  reading.value = true
  try {
    const response = await window.characterArc.readBackupChapters({ name: props.name, projectId: sourceId.value, chapterIds: [id], includeVersions: false })
    if (token !== previewToken) return
    if (!response.success || !response.result) throw new Error(response.error || '读取章节失败')
    content.value = getPlainTextFromEditorContent(response.result.chapters[0].content) || '（空白章节）'
  } catch (e) { if (token === previewToken) error.value = String(e) }
  finally { if (token === previewToken) reading.value = false }
})
async function restore(asProject: boolean) {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    if (!pending.value) {
      const destination = targetId.value, volume = volumeId.value
      const response = await window.characterArc.readBackupChapters({ name: props.name, projectId: sourceId.value, chapterIds: [...selectedIds.value] })
      if (!response.success || !response.result) throw new Error(response.error || '读取章节失败')
      let projectId = destination
      if (asProject) {
        const copied = copyBackupProjectChapters(response.result, () => crypto.randomUUID())
        projectId = store.createProjectWorkspace({ project: { title: `${source.value?.title || '恢复作品'}（备份章节）`, genre: '未分类', premise: '从本地备份恢复的章节与历史版本。', novelLength: 'long', wordCount: '', cover: '' },
          ...copied }, undefined, false)
      } else store.appendBackupChapters(destination, volume, response.result)
      pending.value = { projectId, count: response.result.chapters.length, open: asProject }
    }
    await store.persistWorkspace()
    if (store.persistenceError) throw new Error(`章节已加入当前工作区，保存失败，请重试保存：${store.persistenceError}`)
    const saved = pending.value!
    pending.value = null
    message.success(`已恢复 ${saved.count} 章及其历史版本。`)
    if (saved.open) store.openProject(saved.projectId)
    emit('update:show', false)
  } catch (e) { error.value = String(e) } finally { busy.value = false }
}
function closeKeepingPending() {
  if (busy.value) return
  if (pending.value) message.warning('恢复内容已保留在当前工作区内存中，尚未确认保存。请在主界面重试保存，成功前不要退出应用。')
  emit('update:show', false)
}
</script>
<template>
  <n-modal :show="show" :mask-closable="!busy && !pending" @update:show="!busy && !pending && emit('update:show', $event)">
    <n-card title="预览本地备份" style="width:min(1000px,94vw)" role="dialog" aria-modal="true">
      <p>选取章节恢复为副本，保留正文与历史版本。恢复的章节设为草稿；人物、世界观、数值记录等请使用项目归档或整库恢复。</p>
      <p v-if="loading">正在读取备份目录…</p><p v-if="error" role="alert">{{ error }}</p>
      <p v-if="pending">章节已加入，等待保存确认。重试不会重复添加。</p>
      <fieldset :disabled="busy || !!pending || loading" :inert="busy || !!pending || loading">
        <n-select v-model:value="sourceId" :options="catalog.projects.map(p => ({ label: `${p.title} · ${p.chapters.length} 章`, value: p.id }))" placeholder="选择备份中的作品" />
        <div class="backup-body">
          <div class="chapter-list">
            <label><input type="checkbox" :checked="!!source?.chapters.length && selectedIds.length === source.chapters.length" @change="selectedIds = ($event.target as HTMLInputElement).checked ? source?.chapters.map(c => c.id) ?? [] : []">全选本作品章节</label>
            <label v-for="c in source?.chapters" :key="c.id"><input v-model="selectedIds" type="checkbox" :value="c.id"><button type="button" :aria-pressed="previewId === c.id" @click="previewId = c.id">{{ c.volumeTitle }} · {{ c.title }}</button></label>
          </div>
          <pre class="chapter-content">{{ reading ? '正在读取正文…' : content || '点击章节标题预览正文' }}</pre>
        </div>
        <div class="destinations"><n-select v-model:value="targetId" :options="store.projects.map(p => ({label:p.title,value:p.id}))" placeholder="目标作品" /><n-select v-model:value="volumeId" :options="targetVolumes.map(v => ({label:v.title,value:v.id}))" placeholder="目标分卷" /></div>
      </fieldset>
      <template #footer><div class="actions">
        <n-button :disabled="busy" @click="closeKeepingPending">{{ pending ? '保留内容并退出' : '关闭' }}</n-button>
        <n-button :disabled="busy || !!pending || loading" @click="emit('restoreAll')">恢复整个工作区…</n-button>
        <n-button v-if="pending" type="primary" :loading="busy" @click="restore(false)">重试保存</n-button>
        <template v-else>
          <n-button :disabled="busy || !selectedIds.length" @click="restore(true)">将所选 {{ selectedIds.length }} 章恢复为新作品</n-button>
          <n-button type="primary" :disabled="busy || !selectedIds.length || !volumeId" @click="restore(false)">恢复到目标分卷</n-button>
        </template>
      </div></template>
    </n-card>
  </n-modal>
</template>
<style scoped>
fieldset{border:0;padding:0;min-width:0}.backup-body{display:grid;grid-template-columns:minmax(180px,35%) 1fr;gap:16px;margin:16px 0;height:42vh}.chapter-list,.chapter-content{overflow:auto;border:1px solid var(--arc-border);padding:12px;margin:0}.chapter-list label{display:flex;align-items:baseline;gap:6px;margin-bottom:8px}.chapter-list button{background:none;border:0;text-align:left;color:var(--arc-text-primary);cursor:pointer}.chapter-list button[aria-pressed=true]{font-weight:bold}.chapter-content{white-space:pre-wrap;overflow-wrap:anywhere;font-family:inherit}.destinations{display:flex;gap:12px}.actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}p{line-height:1.7}p[role=alert]{color:var(--arc-danger,#c33)}
</style>
