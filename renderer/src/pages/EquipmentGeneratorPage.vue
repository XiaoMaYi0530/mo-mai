<script setup lang="ts">
import { ChevronLeft } from 'lucide-vue-next'
import { NButton, NTabPane, NTabs } from 'naive-ui'
import OriginalEquipmentGeneratorPanel from '@/components/home/OriginalEquipmentGeneratorPanel.vue'
import OriginalSkillGeneratorPanel from '@/components/home/OriginalSkillGeneratorPanel.vue'
import { useAppStore } from '@/stores/app'

const appStore = useAppStore()
</script>

<template>
  <section class="equipment-generator-page">
    <header class="equipment-generator-header">
      <NButton quaternary @click="appStore.backToProjects()">
        <template #icon><ChevronLeft :size="16" /></template>
        返回项目中心
      </NButton>
    </header>
    <main class="equipment-generator-main arc-scrollbar">
      <NTabs class="tool-tabs" type="segment" animated>
        <NTabPane name="equipment" tab="原创装备库"><OriginalEquipmentGeneratorPanel /></NTabPane>
        <NTabPane name="skills" tab="技能／法术库"><OriginalSkillGeneratorPanel /></NTabPane>
      </NTabs>
    </main>
  </section>
</template>

<style scoped>
.equipment-generator-page{display:flex;min-width:0;height:100%;overflow:hidden;flex-direction:column;background:radial-gradient(circle at top right,color-mix(in srgb,var(--arc-primary) 7%,transparent),transparent 32%),var(--arc-bg-body)}
.equipment-generator-header{display:flex;align-items:center;padding:18px 20px 12px}.equipment-generator-main{flex:1;min-width:0;min-height:0;padding:0 20px 24px;overflow:auto}
.tool-tabs :deep(.n-tabs-nav){width:min(100%,520px);margin:0 auto 20px}.tool-tabs :deep(.n-tabs-nav-scroll-content){width:100%}.tool-tabs :deep(.n-tabs-tab-wrapper){flex:1;min-width:0}.tool-tabs :deep(.n-tabs-tab){width:100%;min-width:0;padding:0 24px;justify-content:center;white-space:nowrap}.equipment-generator-main :deep(.n-tab-pane){padding-top:0}
@media(max-width:720px){.equipment-generator-header{padding:14px 14px 10px}.equipment-generator-main{padding:0 14px 18px}}
</style>
