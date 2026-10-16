import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const source = readFileSync(new URL('./persistence.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const mergeSource = readFileSync(new URL('./mergeRemoteWorkspace.ts', import.meta.url), 'utf8')
const mergeCompiled = ts.transpileModule(mergeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

function loadPersistence() {
  const exports = {}
  const mergeExports = {}
  new Function('require', 'exports', mergeCompiled)(require, mergeExports)
  const moduleRequire = (id) => {
    if (id === 'vue') return require('vue')
    if (id.includes('autoSave')) return { FAST_PERSIST_DELAY_MS: 100, resolveAutoSaveDelayMs: () => 1000 }
    if (id.includes('ipcPayload')) return { toIpcPayload: (value) => value }
    if (id.includes('mergeRemoteWorkspace')) return mergeExports
    throw new Error(`Unexpected import: ${id}`)
  }
  new Function('require', 'exports', compiled)(moduleRequire, exports)
  return exports.createWorkspacePersistence
}

test('remote AI update preserves an unsaved local chapter edit', () => {
  const originalWindow = globalThis.window
  const timers = new Map()
  let nextTimer = 1
  globalThis.window = {
    setTimeout: (callback) => { const id = nextTimer++; timers.set(id, callback); return id },
    clearTimeout: (id) => timers.delete(id),
    characterArc: { publishWorkspaceSync: async () => ({ success: true }) }
  }
  try {
    let state = {
      workspaceRevision: 1,
      projects: [{ id: 'p', title: '小说' }],
      workspaces: { p: { chapters: [{ id: 'c', content: '原文', title: '第一章' }] } },
      aiRuns: []
    }
    const createWorkspacePersistence = loadPersistence()
    const persistence = createWorkspacePersistence({
      hasHydrated: { value: true },
      serializeWorkspaceState: () => structuredClone(state),
      getSettingsSnapshot: () => ({ appSettings: { autoSaveInterval: '5m' } }),
      applyRemoteState: (payload) => { state = structuredClone(payload) },
      setWorkspaceRevision: (revision) => { state.workspaceRevision = revision }
    })
    persistence.markWorkspaceLoaded()
    state.workspaces.p.chapters[0].content = '未保存的本地正文'
    persistence.schedulePersist('autosave')
    persistence.handleRemoteWorkspaceSync({
      workspaceRevision: 2,
      projects: [{ id: 'p', title: '小说' }],
      workspaces: { p: { chapters: [{ id: 'c', content: '原文', title: 'AI 更新的章名' }] } },
      aiRuns: [{ id: 'new-ai-run' }]
    })
    assert.equal(state.workspaces.p.chapters[0].content, '未保存的本地正文')
    assert.equal(state.workspaces.p.chapters[0].title, 'AI 更新的章名')
    assert.deepEqual(state.aiRuns, [{ id: 'new-ai-run' }])
    assert.equal(state.workspaceRevision, 2)
  } finally {
    globalThis.window = originalWindow
  }
})

test('simultaneous edits to the same chapter keep the author text and archive the remote draft', () => {
  const originalWindow = globalThis.window
  globalThis.window = {
    setTimeout: () => 1,
    clearTimeout: () => {},
    characterArc: { publishWorkspaceSync: async () => ({ success: true }) }
  }
  try {
    const chapter = { id: 'c', content: '原文', title: '第一章', summary: '', status: 'draft', wordTarget: '3000字' }
    let state = { workspaceRevision: 1, workspaces: { p: { chapters: [chapter], chapterVersions: [] } } }
    const persistence = loadPersistence()({
      hasHydrated: { value: true },
      serializeWorkspaceState: () => structuredClone(state),
      getSettingsSnapshot: () => ({ appSettings: { autoSaveInterval: '5m' } }),
      applyRemoteState: (payload) => { state = structuredClone(payload) },
      setWorkspaceRevision: (revision) => { state.workspaceRevision = revision }
    })
    persistence.markWorkspaceLoaded()
    state.workspaces.p.chapters[0].content = '作者还在输入'
    persistence.schedulePersist('autosave')
    persistence.handleRemoteWorkspaceSync({
      workspaceRevision: 2,
      workspaces: { p: { chapters: [{ ...chapter, content: 'AI 改写结果' }], chapterVersions: [] } }
    })
    assert.equal(state.workspaces.p.chapters[0].content, '作者还在输入')
    assert.equal(state.workspaces.p.chapterVersions[0].content, 'AI 改写结果')
    assert.equal(state.workspaces.p.chapterVersions[0].chapterId, 'c')
  } finally {
    globalThis.window = originalWindow
  }
})
