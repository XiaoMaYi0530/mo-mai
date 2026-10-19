<script setup lang="ts">
import { ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useAppStore } from '@/stores/app'
import { normalizeReferenceUsage, REFERENCE_PURPOSE_LABELS, type ReferenceUsage } from '@shared/reference-usage'
const store = useAppStore()
const message = useMessage()
const rows = ref<ReferenceUsage[]>([])
const busy = ref(false)
watch(() => store.selectedProjectId, () => {
  rows.value = normalizeReferenceUsage(store.currentProject?.referenceUsage)
  if (!rows.value.length) rows.value = (store.currentProject?.selectedReferenceWorkIds ?? []).slice(0,3).map((id,index) => ({ referenceWorkId:id,role:index===0?'main':'auxiliary',purpose:'pacing',boundary:'' }))
}, { immediate:true })
async function save() {
  const filled = rows.value.filter(row => row.referenceWorkId)
  if (new Set(filled.map(row => row.referenceWorkId)).size !== filled.length) { message.warning('每本参考只能担任一个角色。'); return }
  busy.value = true
  try {
    store.updateProject(store.selectedProjectId,{referenceUsage:normalizeReferenceUsage(filled),selectedReferenceWorkIds:filled.map(row=>row.referenceWorkId)})
    await store.persistWorkspace()
    if(store.persistenceError) throw new Error(store.persistenceError)
    message.success('结构参考分工已保存，后续 AI 创作会遵守该分工。')
  } catch(error) { message.error(String(error)) } finally { busy.value=false }
}
</script>
<template>
  <section class="reference-usage">
    <h3>结构参考分工</h3>
    <p>最多 1 本主参考和 2 本辅助参考。这里的用途用于后续创作，文风继续由独立绑定控制。</p>
    <div v-for="(row,index) in rows" :key="index" class="usage-row">
      <strong>{{ index === 0 ? '主参考' : `辅助参考 ${index}` }}</strong>
      <select v-model="row.referenceWorkId" aria-label="参考作品"><option value="">选择参考作品</option><option v-for="work in store.referenceWorks" :key="work.id" :value="work.id">{{ work.title }}</option><option v-if="row.referenceWorkId && !store.referenceWorks.some(work=>work.id===row.referenceWorkId)" :value="row.referenceWorkId">原参考已删除，请更换</option></select>
      <select v-model="row.purpose" aria-label="参考用途"><option v-for="(label,key) in REFERENCE_PURPOSE_LABELS" :key="key" :value="key">{{ label }}</option></select>
      <button @click="rows.splice(index,1)">移除</button>
      <textarea v-model="row.boundary" maxlength="1000" placeholder="参考边界，例如只借任务推进节奏，不借角色和具体事件" aria-label="参考边界" />
    </div>
    <button :disabled="rows.length>=3" @click="rows.push({referenceWorkId:'',role:rows.length?'auxiliary':'main',purpose:'pacing',boundary:''})">添加参考</button>
    <button :disabled="busy" @click="save">保存参考分工</button>
  </section>
</template>
<style scoped>
.reference-usage{padding:18px;border:1px solid var(--arc-border);border-radius:12px;margin:16px 0}p{color:var(--arc-text-secondary)}.usage-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:14px 0}textarea{flex-basis:100%;min-height:60px}select,textarea,button{background:var(--arc-bg-surface);color:var(--arc-text-primary);border:1px solid var(--arc-border);padding:8px;border-radius:6px}button{margin-right:8px;cursor:pointer}button:disabled{opacity:.5}
</style>
