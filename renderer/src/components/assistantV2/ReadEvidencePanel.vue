<script setup lang="ts">
import { computed } from 'vue'
import { summarizeReadReceipts } from '@shared/project-read-receipt'
import type { AssistantToolCallView } from '@/composables/useAssistant'
const props = defineProps<{ calls: AssistantToolCallView[] }>()
const groups = computed(() => summarizeReadReceipts(props.calls.flatMap(call => call.status === 'ok' && call.readReceipt ? [call.readReceipt] : [])))
const labels: Record<string,string> = {characters:'人物',worldview:'世界观',chapters:'章节',outline:'大纲',organizations:'组织'}
const modes: Record<string,string> = { full:'全文已读取', summary:'仅摘要', partial:'部分内容', unread:'尚未读取' }
</script>
<template>
  <details v-if="groups.length" class="read-evidence">
    <summary>本次参考资料 · {{ groups.reduce((n,g)=>n+g.full,0) }} 条全文已读取</summary>
    <p>记录本轮工具实际返回的范围。自动上下文还可能包含其他摘要；读取完成不代表分析结论一定正确。</p>
    <section v-for="group in groups" :key="group.module">
      <strong>{{ labels[group.module] || group.module }}：完整 {{ group.full }} / {{ group.total }}，尚未完整读取 {{ group.remaining }}</strong>
      <ul><li v-for="item in group.items" :key="item.id"><span>{{ item.title }}</span><small>{{ modes[item.mode] }}</small></li></ul>
    </section>
  </details>
</template>
<style scoped>
.read-evidence{border:1px solid var(--arc-border);border-radius:8px;padding:10px 12px;margin:10px 0;font-size:12px}summary{cursor:pointer;font-weight:600}p,small{color:var(--arc-text-secondary)}ul{max-height:260px;overflow:auto;padding-left:16px}li{padding:4px 0}small{margin-left:10px}section{margin:10px 0}
</style>
