import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('../../../../', import.meta.url))
const readSource = (path) => readFileSync(new URL(path, `file:///${rootDir.replaceAll('\\', '/')}/`), 'utf8')

test('拆书创建项目先生成可审阅骨架，并强制原创化转换', () => {
  const task = readSource('electron/main/ai/tasks/reference-project-blueprint.ts')
  const modal = readSource('renderer/src/components/ReferenceProjectBlueprintModal.vue')

  assert.match(task, /不得沿用参考作品的人名、地名、势力名/)
  assert.match(task, /不得按参考作品章节逐章一一对应/)
  assert.match(task, /transformationNotes/)
  assert.match(modal, /尚未创建项目/)
  assert.match(modal, /确认骨架并创建项目/)
  assert.match(modal, /\[asset\.id\]/)
  assert.doesNotMatch(modal, /长篇（3-4 卷骨架）/)
  assert.match(modal, /自动分卷/)
  assert.match(modal, /手动分卷/)
  assert.match(modal, /深度拆书覆盖率/)
  assert.doesNotMatch(task, /作品长度：/)
  assert.doesNotMatch(task, /每卷包含 title、wordTarget/)
  assert.match(task, /chapterPlan/)
  assert.match(task, /不得机械固定章数/)
  assert.match(modal, /章建议/)
})

test('拆书创建小说先发散四条路线，用户选择后才生成骨架', () => {
  const conceptTask = readSource('electron/main/ai/tasks/story-concept-options.ts')
  const blueprintTask = readSource('electron/main/ai/tasks/reference-project-blueprint.ts')
  const modal = readSource('renderer/src/components/ReferenceProjectBlueprintModal.vue')
  const schema = readSource('electron/main/ai/tasks/object-schemas.ts')
  const skill = readSource('resources/skills/Distilled-Novel-Toolbox/novel-innovation/SKILL.md')

  assert.match(conceptTask, /生成恰好 4 条可选择的原创故事路线/)
  assert.match(conceptTask, /凡用户已经明确的人名、身份、能力名称与机制、世界规则/)
  assert.match(conceptTask, /不得擅自换主角、改能力、换世界/)
  assert.match(conceptTask, /四条路线必须在“因果发动机”上真正不同/)
  assert.match(modal, /task: 'story-concept-options'/)
  assert.match(modal, /生成 4 条创意思路/)
  assert.match(modal, /基于已选路线生成骨架/)
  assert.match(modal, /selectedConcept: selectedConcept\.value/)
  assert.match(blueprintTask, /锁定事实 > 用户选中的故事路线/)
  assert.match(blueprintTask, /不得重新发明另一部小说/)
  assert.match(schema, /chapterPlan: z\.array/)
  assert.match(skill, /name: 网文创意孵化/)
  assert.doesNotMatch(skill, /2026网文趋势关键词/)
})

test('拆书骨架优先细化首卷，远期卷不提前创建章节', () => {
  const task = readSource('electron/main/ai/tasks/reference-project-blueprint.ts')
  const seed = readSource('renderer/src/features/wizard/projectSeed.ts')
  const modal = readSource('renderer/src/components/ReferenceProjectBlueprintModal.vue')
  const outlinePanel = readSource('renderer/src/components/OutlinePanel.vue')

  assert.match(task, /第一卷优先给出 8-12 个有因果递进的剧情节点/)
  assert.match(task, /第二卷给出 3-6 个方向节点/)
  assert.match(task, /更远的卷各保留 1-2 个关键里程碑/)
  assert.match(task, /第一卷至少需要 8 个剧情节点/)
  assert.match(task, /第一卷至少需要 16 个首批章节建议/)
  assert.match(task, /第二卷及以后 chapterPlan 返回空数组/)
  assert.match(seed, /if \(source\?\.volumeIndex !== 0\) return \[\]/)
  assert.match(modal, /采用滚动规划/)
  assert.match(outlinePanel, /若新剧情改变后续.*卷的前提，请核对承接并按需调整大纲/)
})

test('风格指纹优先注入正文，Codex CLI 拆书走宿主工具桥接', () => {
  const draft = readSource('renderer/src/components/chapterWorkspace/useChapterFirstDraft.ts')
  const orchestrator = readSource('electron/main/ai/runtime/orchestrator.ts')
  const agent = readSource('electron/main/ai/agent/index.ts')

  assert.match(draft, /buildProjectStyleFingerprintContext/)
  assert.match(draft, /project\.styleFingerprintBinding/)
  assert.match(orchestrator, /codexToolBridgeTasks/)
  assert.match(agent, /producedKnowledgeDocuments\.length === 0/)
  assert.match(agent, /task\.task === 'style-fingerprint-extract' \|\| task\.task === 'reference-deep-analyze'[\s\S]*\? knowledgeTools/)
  assert.match(agent, /requiredToolNames:[\s\S]*knowledge_save_document/)
})

test('风格指纹方法直接注入并显示持久状态', () => {
  const task = readSource('electron/main/ai/tasks/style-fingerprint-extract.ts')
  const panel = readSource('renderer/src/components/KnowledgeCenterPanel.vue')

  assert.match(task, /不要调用.*skill_load/)
  assert.match(task, /第一轮回复必须直接调用/)
  assert.match(panel, /风格指纹已提取/)
  assert.match(panel, /查看指纹/)
})
