import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('项目归档导出前会等待最新工作区保存完成', async () => {
  const source = await readSource('../../components/SettingsPanel.vue')
  const saveIndex = source.indexOf('await appStore.persistWorkspace()')
  const exportIndex = source.indexOf('window.characterArc.exportProjectArchive')
  assert.ok(saveIndex >= 0, '导出前应显式保存工作区')
  assert.ok(saveIndex < exportIndex, '保存必须发生在归档导出调用之前')
})

test('封面生成记录只保存在当前会话，工作区不再序列化大图', async () => {
  const [panelSource, storeSource] = await Promise.all([
    readSource('../../components/home/ProjectCoverWorkbenchPanel.vue'),
    readSource('../../stores/app.ts')
  ])
  assert.match(panelSource, /const sessionHistory = ref/)
  assert.doesNotMatch(panelSource, /updateCoverWorkbenchHistory/)
  assert.match(panelSource, /installProjectCover/)
  assert.match(panelSource, /v-model:value="selectedProjectId"/)
  assert.match(storeSource, /coverWorkbenchHistory:\s*\[\]/)
})

test('初稿窗口可最小化，并能从 AI 后台任务恢复', async () => {
  const [dialogSource, workspaceSource, controllerSource, taskSource, taskCenterSource] = await Promise.all([
    readSource('../../components/chapterWorkspace/ChapterFirstDraftDialog.vue'),
    readSource('../../components/chapterWorkspace/ChapterWorkspace.vue'),
    readSource('../../components/chapterWorkspace/useChapterFirstDraft.ts'),
    readSource('../ai/taskRegistry.ts'),
    readSource('../../components/TitlebarAiTaskCenter.vue')
  ])
  assert.match(dialogSource, /minimize:/)
  assert.match(workspaceSource, /<ChapterFirstDraftDialog/)
  assert.match(controllerSource, /onOpen:/)
  assert.match(taskSource, /onOpen\?: \(\) => void/)
  assert.match(taskCenterSource, /恢复任务窗口/)
})

test('更新项目时允许用空字符串清除封面', async () => {
  const source = await readSource('../../stores/app.ts')
  assert.match(source, /cover:\s*payload\.cover !== undefined \? payload\.cover : project\.cover/)
})

test('游戏装备与人物信息卡只使用应用级主题变量，浅色模式不会出现深底深字', async () => {
  const source = await readSource('../../components/chapterWorkspace/GameProgressionPanel.vue')
  assert.doesNotMatch(source, /var\(--(?:surface-secondary|text-tertiary|border-color)/)
  assert.match(source, /\.equipment-cell\{[^}]*background:var\(--arc-bg-surface\)/)
  assert.match(source, /\.skill-card\{[^}]*background:var\(--arc-bg-surface\)/)
  assert.match(source, /\.profile-card\{[^}]*background:var\(--arc-bg-weak\)/)
})

test('装备与技能库位于高级工具并默认每五级生成成长阶段', async () => {
  const [heroSource, panelSource, skillSource, pageSource, appSource] = await Promise.all([
    readSource('../../components/home/HomepageHero.vue'),
    readSource('../../components/home/OriginalEquipmentGeneratorPanel.vue'),
    readSource('../../components/home/OriginalSkillGeneratorPanel.vue'),
    readSource('../../pages/EquipmentGeneratorPage.vue'),
    readSource('../../App.vue')
  ])
  assert.match(heroSource, /装备与技能库/)
  assert.match(panelSource, /const mode = ref<OriginalEquipmentMode>\('stages'\)/)
  assert.match(panelSource, /const levelStep = ref\(5\)/)
  assert.match(panelSource, /按等级阶段生成整套/)
  assert.match(skillSource, /const levelStep = ref\(5\)/)
  assert.match(skillSource, /types = ref<OriginalSkillType\[]>\(\['spell', 'combat'\]\)/)
  assert.match(pageSource, /技能／法术库/)
  assert.match(appSource, /currentView === 'equipment-generator'/)
})

test('装备与技能库标签具有独立且等宽的选择区域', async () => {
  const source = await readSource('../../pages/EquipmentGeneratorPage.vue')
  assert.match(source, /<NTabs[^>]*class="tool-tabs"/)
  assert.match(source, /\.tool-tabs\s*:deep\(\.n-tabs-nav\)\{[^}]*width:min\(100%,520px\)/)
  assert.match(source, /\.tool-tabs\s*:deep\(\.n-tabs-tab-wrapper\)\{[^}]*flex:1/)
  assert.match(source, /\.tool-tabs\s*:deep\(\.n-tabs-tab\)\{[^}]*justify-content:center/)
})

test('回收站穿过工作区标准化与归档，避免删除后在中间层被静默丢弃', async()=>{
  const [helpers,workspace,archive]=await Promise.all([readSource('./storeHelpers.ts'),readSource('./projectWorkspace.ts'),readSource('../../../../electron/main/archive/project-archive.ts')])
  assert.match(helpers,/deletedChapters: normalized\.deletedChapters/)
  assert.match(workspace,/deletedChapters: workspace\.deletedChapters/)
  assert.match(archive,/addJson\(zip, 'workspace\/deletedChapters\.json'/)
  assert.match(archive,/deletedChapters: await readZipJson/)
})
