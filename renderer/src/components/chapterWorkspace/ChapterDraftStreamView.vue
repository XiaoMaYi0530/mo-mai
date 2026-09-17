<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  outputTitle?: string
  outputContent?: string
  reasoningContent?: string
  placeholder?: string
}>(), {
  outputTitle: '实时生成内容',
  outputContent: '',
  reasoningContent: '',
  placeholder: 'AI 正在准备内容'
})

const activeView = ref<'output' | 'reasoning'>('output')

watch(() => props.reasoningContent, (reasoning, previousReasoning) => {
  if (!props.outputContent && reasoning && !previousReasoning) activeView.value = 'reasoning'
})

watch(() => props.outputContent, (output, previousOutput) => {
  if (output && !previousOutput) activeView.value = 'output'
})
</script>

<template>
  <section class="stream-view">
    <div class="stream-tabs" role="tablist" aria-label="AI 初稿执行详情">
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'output'"
        :class="{ active: activeView === 'output' }"
        @click="activeView = 'output'"
      >
        生成内容
        <span v-if="outputContent">{{ outputContent.length.toLocaleString('zh-CN') }} 字符</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeView === 'reasoning'"
        :class="{ active: activeView === 'reasoning' }"
        @click="activeView = 'reasoning'"
      >
        AI 推理过程
        <span v-if="reasoningContent">实时</span>
      </button>
    </div>

    <div class="stream-body arc-scrollbar">
      <template v-if="activeView === 'output'">
        <div class="stream-title">{{ outputTitle }}</div>
        <pre v-if="outputContent">{{ outputContent }}</pre>
        <div v-else class="stream-placeholder">
          <span>{{ placeholder }}</span>
          <span class="blink-cursor" />
        </div>
      </template>
      <template v-else>
        <div class="stream-title reasoning-title"><span class="reasoning-dot" />模型返回的推理摘要</div>
        <pre v-if="reasoningContent" class="reasoning-content">{{ reasoningContent }}</pre>
        <div v-else class="stream-placeholder">
          当前模型尚未返回可展示的推理内容；这不会影响正文生成。
        </div>
      </template>
    </div>
  </section>
</template>

<style scoped>
.stream-view {
  overflow: hidden;
  border: 1px solid var(--arc-border);
  border-radius: var(--arc-radius-md);
  background: var(--arc-bg-body);
}
.stream-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  padding: 4px;
  border-bottom: 1px solid var(--arc-border);
  background: var(--arc-bg-surface);
}
.stream-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  padding: 7px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--arc-text-secondary);
  font-size: 12px;
  cursor: pointer;
}
.stream-tabs button.active {
  background: var(--arc-primary-soft);
  color: var(--arc-primary);
  font-weight: 600;
}
.stream-tabs button span {
  color: var(--arc-text-hint);
  font-size: 10px;
  font-weight: 400;
}
.stream-body {
  min-height: 150px;
  max-height: min(340px, 38vh);
  overflow-y: auto;
  padding: 14px 16px;
}
.stream-title {
  margin-bottom: 9px;
  color: var(--arc-text-hint);
  font-size: 11px;
  letter-spacing: 0.03em;
}
.reasoning-title { display: flex; align-items: center; gap: 6px; }
.reasoning-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--arc-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--arc-primary) 12%, transparent); }
pre {
  margin: 0;
  color: var(--arc-text-primary);
  font-family: inherit;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}
.reasoning-content { color: var(--arc-text-secondary); }
.stream-placeholder {
  display: flex;
  min-height: 100px;
  align-items: center;
  justify-content: center;
  color: var(--arc-text-hint);
  font-size: 12px;
  line-height: 1.6;
  text-align: center;
}
.blink-cursor {
  width: 2px;
  height: 14px;
  margin-left: 4px;
  border-radius: 1px;
  background: var(--arc-primary);
  animation: blink 0.9s step-end infinite;
}
@keyframes blink { 0%, 45% { opacity: 1; } 50%, 100% { opacity: 0; } }
</style>
