<script setup lang="ts">
import {
  NAlert,
  NButton,
  NCard,
  NCheckbox,
  NCollapse,
  NCollapseItem,
  NForm,
  NFormItem,
  NInput,
  NModal,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag
} from 'naive-ui'
import { useReferenceProjectCreation, type ReferenceCreationProps } from '@/features/wizard/useReferenceProjectCreation'
const props = defineProps<ReferenceCreationProps>()
const emit = defineEmits<{ 'update:show': [value: boolean] }>()
const { generatingStage, generating, conceptResult, selectedConceptId, result, editingBlueprint, revisionMessages, revisionInput, revisionBusy, revisionProposal, creationMode, directNovelLength, reuseCurrentWorldview, sourceProject, sourceWorldviewEntries, purposeOptions, referencePlan, auxiliaryAssetOptions, styleReferenceOptions, form, genreOptions, draftSavedAt, restoredDraft, startFreshDraft, selectedConcept, groupedOutline, close, startEditingBlueprint, cancelEditingBlueprint, saveEditingBlueprint, addOutlineItem, removeOutlineItem, addChapterPlan, removeChapterPlan, sendRevisionRequest, adoptRevision, discardRevision, revisionEditLabel, revisionExistingTitle, generateConceptOptions, selectConcept, generateBlueprint, createProject, createDirectProject } = useReferenceProjectCreation(props, emit)
</script>

<template>
  <n-modal :show="show" :mask-closable="!generating && !revisionBusy" @update:show="!generating && !revisionBusy && emit('update:show', $event)">
    <n-card class="blueprint-modal" :bordered="false" role="dialog" aria-modal="true">
      <template #header>
        <div class="modal-title">
          <strong>基于拆书创建原创小说</strong>
          <span v-if="asset">主参考：《{{ asset.title }}》 · 最多添加 2 本辅助参考</span>
        </div>
      </template>

      <div class="modal-body-scroll">
      <n-alert type="info" :show-icon="false">
        可以先生成并审阅原创骨架，也可以复制当前小说的世界观后直接创建空白项目。结构参考与文风绑定分别设置。
      </n-alert>

      <div class="creation-mode">
        <strong>创建方式</strong>
        <n-radio-group v-model:value="creationMode" :disabled="generating || revisionBusy">
          <n-radio-button value="blueprint">生成并审阅骨架</n-radio-button>
          <n-radio-button value="direct">不生成骨架，直接创建</n-radio-button>
        </n-radio-group>
      </div>

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

      <n-alert v-if="draftSavedAt" type="info" style="margin-bottom: 12px">
        {{ restoredDraft ? '已恢复上次创建草稿。' : '创建进度已自动保存。' }}关闭后可继续；包含手动编辑及待确认修改稿。
        <n-button size="small" :disabled="generating || revisionBusy" @click="startFreshDraft">重新开始</n-button>
      </n-alert>
      <section v-if="asset" class="reference-plan">
        <strong>结构参考分工</strong>
        <p>每本只提取对应的拆书结论；主参考决定核心结构，辅助参考补充指定维度。</p>
        <div class="reference-row">
          <span>主参考 · 《{{ asset.title }}》</span>
          <n-select v-model:value="referencePlan.mainPurpose" :options="purposeOptions" aria-label="主参考用途" />
        </div>
        <div v-for="(entry, index) in referencePlan.auxiliaries" :key="index" class="reference-row">
          <n-select v-model:value="entry.id" :options="auxiliaryAssetOptions" clearable :placeholder="`辅助参考 ${index + 1}（可选）`" />
          <n-select v-model:value="entry.purpose" :options="purposeOptions" :disabled="!entry.id" :aria-label="`辅助参考 ${index + 1} 用途`" />
        </div>
        <div class="style-choice">
          <n-checkbox v-model:checked="referencePlan.bindStyle">同时绑定文风指纹</n-checkbox>
          <n-select
            v-if="referencePlan.bindStyle"
            v-model:value="referencePlan.styleReferenceId"
            :options="styleReferenceOptions"
            placeholder="选择文风来源（与结构用途独立）"
            aria-label="文风来源"
          />
          <small v-else>默认不绑定文风；以后可在项目设置中选择。</small>
        </div>
      </section>

      <n-form label-placement="top" class="blueprint-form">
        <div class="form-grid">
          <n-form-item label="新小说名称">
            <n-input v-model:value="form.title" placeholder="例如：灰塔拾荒者" />
          </n-form-item>
          <n-form-item label="题材">
            <n-select v-model:value="form.genre" filterable tag :options="genreOptions" />
          </n-form-item>
        </div>
        <n-form-item v-if="creationMode === 'blueprint'" label="分卷方式">
          <n-radio-group v-model:value="form.volumeMode">
            <n-radio-button value="auto">自动分卷</n-radio-button>
            <n-radio-button value="manual">手动分卷</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-form-item v-if="creationMode === 'blueprint' && form.volumeMode === 'manual'" label="分卷草案">
          <n-input
            v-model:value="form.manualVolumePlan"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 7 }"
            placeholder="每行一卷，可只写卷名，也可写“卷名｜本卷阶段目标”。不需要填写字数或预计章节数。"
          />
        </n-form-item>
        <n-form-item :label="creationMode === 'blueprint' ? '原创方向（必填）' : '原创方向（可选）'">
          <n-input
            v-model:value="form.premise"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="说明你真正想写的主角身份、核心冲突、世界差异或读者爽点。写得越具体，越不会接近参考作品。"
          />
        </n-form-item>
      </n-form>

      <section v-if="creationMode === 'direct'" class="direct-create-options">
        <strong>直接创建的内容</strong>
        <n-form-item label="小说篇幅">
          <n-radio-group v-model:value="directNovelLength">
            <n-radio-button value="long">长篇</n-radio-button>
            <n-radio-button value="short">短篇</n-radio-button>
          </n-radio-group>
        </n-form-item>
        <n-checkbox v-model:checked="reuseCurrentWorldview" :disabled="!sourceProject || sourceWorldviewEntries.length === 0">
          复制当前小说《{{ sourceProject?.title || '未选择' }}》的世界观（{{ sourceWorldviewEntries.length }} 条）
        </n-checkbox>
        <p>将复制世界观文字并生成新条目 ID；角色、组织、关系、大纲和正文不会复制。新项目只含空白起始卷与首章占位。</p>
      </section>

      <div v-if="creationMode === 'blueprint'" class="generate-row">
        <n-button type="primary" :loading="generatingStage === 'concepts'" :disabled="generatingStage === 'blueprint' || editingBlueprint || revisionBusy || !!revisionProposal" @click="generateConceptOptions">
          {{ conceptResult ? '重新生成 4 条思路' : '生成 4 条创意思路' }}
        </n-button>
        <span>按所选分工读取拆书结论，不读取整本原文。</span>
      </div>

      <section v-if="creationMode === 'blueprint' && conceptResult" class="concept-review">
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
            :disabled="editingBlueprint || revisionBusy || !!revisionProposal"
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
            :disabled="!selectedConcept || generatingStage === 'concepts' || editingBlueprint || revisionBusy || !!revisionProposal"
            @click="generateBlueprint"
          >
            {{ result ? '按已选路线重新生成骨架' : '基于已选路线生成骨架' }}
          </n-button>
          <span v-if="selectedConcept">已选择：{{ selectedConcept.title }}</span>
          <span v-else>请先点击选择一条路线。</span>
        </div>
      </section>

      <div v-if="creationMode === 'blueprint' && result" class="review-scroll">
        <section class="revision-chat">
          <div class="revision-chat-heading"><strong>和 AI 对话修改骨架</strong><span>例如：“第二卷的阶段目标改成主角主动夺回港口，不要提前揭晓幕后人。”</span></div>
          <div v-if="revisionMessages.length" class="revision-messages" aria-live="polite">
            <p v-for="(item, index) in revisionMessages" :key="index" :class="item.role"><b>{{ item.role === 'user' ? '我' : 'AI' }}</b>{{ item.content }}</p>
          </div>
          <div class="revision-compose">
            <n-input v-model:value="revisionInput" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" :maxlength="1200" :disabled="revisionBusy || editingBlueprint || !!revisionProposal" placeholder="描述你想调整的卷、节点或章节；AI 会先给出局部修改稿" @keydown.enter.exact.prevent="sendRevisionRequest" />
            <n-button type="primary" :loading="revisionBusy" :disabled="!revisionInput.trim() || editingBlueprint || !!revisionProposal" @click="sendRevisionRequest">发送修改要求</n-button>
          </div>
          <div v-if="revisionProposal" class="revision-proposal">
            <strong>待确认的 AI 修改稿 · {{ revisionProposal.edits.length }} 处</strong>
            <p>{{ revisionProposal.reply }}</p>
            <ol>
              <li v-for="(edit, index) in revisionProposal.edits" :key="index">
                <b>{{ revisionEditLabel(edit) }}</b>
                <span v-if="revisionExistingTitle(edit)">原内容：{{ revisionExistingTitle(edit) }}</span>
                <span v-if="edit.title !== undefined">标题：{{ edit.title }}</span>
                <span v-if="edit.conflict !== undefined">冲突：{{ edit.conflict }}</span>
                <span v-if="edit.summary !== undefined">摘要／目标：{{ edit.summary }}</span>
              </li>
            </ol>
            <div><n-button size="small" @click="discardRevision">放弃这次修改</n-button><n-button size="small" type="primary" @click="adoptRevision">采用修改稿</n-button></div>
          </div>
        </section>
        <div class="edit-toolbar">
          <span>{{ editingBlueprint ? '正在修改骨架；保存后即可用修改版创建项目。' : '卷目标、剧情节点和首批章节建议均可在创建前修改。' }}</span>
          <div v-if="editingBlueprint">
            <n-button size="small" @click="cancelEditingBlueprint">放弃修改</n-button>
            <n-button size="small" type="primary" @click="saveEditingBlueprint">保存修改</n-button>
          </div>
          <n-button v-else size="small" secondary :disabled="revisionBusy || !!revisionProposal" @click="startEditingBlueprint">手动编辑骨架</n-button>
        </div>
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

        <n-alert type="info" :show-icon="false">
          采用滚动规划：首卷生成较细的剧情节点和首批章节；第二卷保留阶段推进，后续卷只锁定关键结果。首批章节不代表已覆盖整卷目标字数，写作时可继续扩展当前卷；前卷的改动影响后续里程碑时，再按需调整后续大纲。
        </n-alert>

        <n-collapse class="volume-review" :accordion="!editingBlueprint">
          <n-collapse-item
            v-for="(volume, index) in groupedOutline"
            :key="index"
            :name="index"
            :title="`${volume.title} · ${volume.entries.length} 个节点${index === 0 ? ` · 首批 ${volume.entries.reduce((count, entry) => count + (entry.chapterPlan?.length || 0), 0)} 章建议` : ''}`"
          >
            <div v-if="editingBlueprint" class="volume-editor">
              <label>卷名 <n-input v-model:value="result.outlineVolumes[index].title" placeholder="卷名" /></label>
              <label>本卷阶段目标 <n-input v-model:value="result.outlineVolumes[index].summary" type="textarea" :autosize="{ minRows: 3, maxRows: 7 }" placeholder="本卷目标、主要阻力、关键转折及卷末结果" /></label>
              <div v-for="(entry, entryIndex) in volume.entries" :key="entryIndex" class="beat-editor">
                <div class="editor-heading"><strong>剧情节点 {{ entryIndex + 1 }}</strong><n-button size="tiny" type="error" quaternary @click="removeOutlineItem(entry)">删除节点</n-button></div>
                <label>标题 <n-input v-model:value="entry.title" placeholder="节点标题" /></label>
                <label>核心冲突 <n-input v-model:value="entry.conflict" placeholder="这一节点的核心冲突" /></label>
                <label>剧情摘要 <n-input v-model:value="entry.summary" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" placeholder="具体推进和结果" /></label>
                <div v-if="index === 0" class="chapter-editors">
                  <div v-for="(chapter, chapterIndex) in entry.chapterPlan" :key="chapterIndex" class="chapter-editor">
                    <div class="editor-heading"><strong>章节建议 {{ chapterIndex + 1 }}</strong><n-button size="tiny" type="error" quaternary @click="removeChapterPlan(entry, chapterIndex)">删除章节</n-button></div>
                    <label>标题 <n-input v-model:value="chapter.title" placeholder="章节标题" /></label>
                    <label>本章冲突 <n-input v-model:value="chapter.conflict" placeholder="本章冲突" /></label>
                    <label>章节摘要 <n-input v-model:value="chapter.summary" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" placeholder="本章推进和章末钩子" /></label>
                  </div>
                  <n-button size="small" dashed @click="addChapterPlan(entry)">添加章节建议</n-button>
                </div>
              </div>
              <n-button size="small" dashed @click="addOutlineItem(index)">添加剧情节点</n-button>
            </div>
            <template v-else>
              <p class="volume-summary">{{ volume.summary }}</p>
              <ol class="beat-list">
                <li v-for="(entry, entryIndex) in volume.entries" :key="entryIndex">
                  <strong>{{ entry.title }}</strong>
                  <span>{{ entry.conflict }}</span>
                  <p>{{ entry.summary }}</p>
                  <ol v-if="entry.chapterPlan?.length" class="chapter-plan-list">
                    <li v-for="(chapter, chapterIndex) in entry.chapterPlan" :key="chapterIndex">
                      <b>{{ chapter.title }}</b>
                      <span>{{ chapter.conflict }}</span>
                      <p>{{ chapter.summary }}</p>
                    </li>
                  </ol>
                </li>
              </ol>
            </template>
          </n-collapse-item>
        </n-collapse>
      </div>
      </div>

      <template #footer>
        <div class="modal-footer">
          <n-button :disabled="generating || revisionBusy" @click="close">取消</n-button>
          <n-button v-if="creationMode === 'direct'" type="primary" :disabled="generating || revisionBusy" @click="createDirectProject">
            直接创建小说
          </n-button>
          <n-button v-else type="primary" :disabled="!result || generating || editingBlueprint || revisionBusy || !!revisionProposal" @click="createProject">
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
.creation-mode { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.creation-mode > strong { flex: none; font-size: 13px; }
.direct-create-options { margin: 14px 0; padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.direct-create-options > strong { display: block; margin-bottom: 12px; }
.direct-create-options p { margin: 10px 0 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; }
.coverage-summary { margin-top: 12px; padding: 12px 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.coverage-summary > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.coverage-summary p { margin: 7px 0 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; }
.reference-plan { margin-top: 14px; padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.reference-plan > p { margin: 5px 0 12px; color: var(--arc-text-secondary); font-size: 12px; }
.reference-row { display: grid; grid-template-columns: minmax(0, 1fr) 180px; align-items: center; gap: 10px; margin-top: 8px; }
.reference-row > span { font-size: 13px; }
.style-choice { display: flex; align-items: center; gap: 12px; margin-top: 15px; padding-top: 12px; border-top: 1px solid var(--arc-border); }
.style-choice .n-select { max-width: 320px; }
.style-choice small { color: var(--arc-text-tertiary); }
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
.revision-chat { margin: 8px 0 14px; padding: 14px; border: 1px solid color-mix(in srgb, var(--arc-primary) 28%, var(--arc-border)); border-radius: 10px; background: color-mix(in srgb, var(--arc-primary) 4%, var(--arc-bg-card)); }
.revision-chat-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.revision-chat-heading span { color: var(--arc-text-tertiary); font-size: 12px; }
.revision-messages { max-height: 180px; overflow-y: auto; margin-top: 10px; padding: 4px 8px; border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-card); }
.revision-messages p { margin: 8px 0; color: var(--arc-text-secondary); font-size: 12px; line-height: 1.6; white-space: pre-wrap; }
.revision-messages p.user { color: var(--arc-text-primary); }
.revision-messages b { margin-right: 8px; color: var(--arc-primary); }
.revision-compose { display: flex; align-items: flex-end; gap: 8px; margin-top: 10px; }
.revision-compose .n-button { flex: none; }
.revision-proposal { margin-top: 12px; padding: 12px; border: 1px solid var(--arc-primary); border-radius: 8px; background: var(--arc-bg-card); }
.revision-proposal > p { margin: 6px 0; color: var(--arc-text-secondary); font-size: 12px; }
.revision-proposal ol { max-height: 250px; overflow-y: auto; margin: 8px 0; padding-left: 22px; }
.revision-proposal li { margin: 8px 0; font-size: 12px; line-height: 1.6; }
.revision-proposal li b, .revision-proposal li span { display: block; }
.revision-proposal li span { white-space: pre-wrap; color: var(--arc-text-secondary); }
.revision-proposal > div { display: flex; justify-content: flex-end; gap: 8px; }
.edit-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 8px 0 14px; padding: 10px 12px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.edit-toolbar > span { color: var(--arc-text-secondary); font-size: 12px; }
.edit-toolbar > div { display: flex; flex: none; gap: 8px; }
.volume-editor, .beat-editor, .chapter-editor { display: flex; flex-direction: column; gap: 10px; }
.volume-editor > label, .beat-editor > label, .chapter-editor > label { display: flex; flex-direction: column; gap: 5px; color: var(--arc-text-secondary); font-size: 12px; }
.beat-editor { margin-top: 12px; padding: 14px; border: 1px solid var(--arc-border); border-radius: 10px; background: var(--arc-bg-weak); }
.chapter-editors { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; padding-left: 12px; border-left: 3px solid var(--arc-primary); }
.chapter-editor { padding: 12px; border: 1px solid var(--arc-border); border-radius: 8px; background: var(--arc-bg-card); }
.editor-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.editor-heading strong { font-size: 12px; }
.volume-editor > .n-button { align-self: flex-start; margin-top: 12px; }
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
@media (max-width: 720px) { .form-grid, .concept-grid, .reference-row { grid-template-columns: 1fr; } .creation-mode, .style-choice, .edit-toolbar, .revision-chat-heading, .revision-compose { align-items: stretch; flex-direction: column; } }
</style>
