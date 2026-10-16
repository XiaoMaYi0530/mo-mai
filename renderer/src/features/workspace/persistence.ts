import { ref, type Ref } from 'vue'
import { FAST_PERSIST_DELAY_MS, resolveAutoSaveDelayMs } from '@/features/settings/autoSave'
import { toIpcPayload } from '@/utils/ipcPayload'
import type { AppSettings, ThemeName } from '@/types/app'
import type { StoredState } from './storeHelpers'
import { mergeRemoteWorkspace } from './mergeRemoteWorkspace'

const SETTINGS_PERSIST_DELAY_MS = 300
const WORKSPACE_SYNC_DELAY_MS = 120

export interface WorkspacePersistenceDeps {
  hasHydrated: Ref<boolean>
  serializeWorkspaceState: () => StoredState
  getSettingsSnapshot: () => {
    theme: ThemeName
    selectedProjectId: string
    appSettings: AppSettings
  }
  applyRemoteState: (payload: Partial<StoredState>) => void
  setWorkspaceRevision: (revision: number) => void
}

export function createWorkspacePersistence(deps: WorkspacePersistenceDeps) {
  let saveTimer: number | null = null
  let settingsSaveTimer: number | null = null
  let workspaceSyncTimer: number | null = null
  let persistPromise: Promise<void> | null = null
  let persistRequested = false
  let isApplyingRemoteWorkspaceSync = false
  let lastRemoteSnapshot: StoredState | null = null
  const scheduledPersistAt = ref<number | null>(null)
  const isPersisting = ref(false)
  const persistenceError = ref<string | null>(null)
  const syncConflictNotice = ref<{ id: number; chapterCount: number } | null>(null)

  function scheduleWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
    }
    workspaceSyncTimer = window.setTimeout(() => {
      void window.characterArc.publishWorkspaceSync(toIpcPayload(deps.serializeWorkspaceState()))
    }, WORKSPACE_SYNC_DELAY_MS)
  }

  function flushWorkspaceSync(): void {
    if (!deps.hasHydrated.value || isApplyingRemoteWorkspaceSync) {
      return
    }
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
      workspaceSyncTimer = null
    }
    const submitted = deps.serializeWorkspaceState()
    const result = window.characterArc.saveWorkspaceSync(toIpcPayload(submitted))
    persistenceError.value = result.success ? null : result.error ?? '保存失败'
    if (result.success) {
      if (typeof result.revision === 'number') deps.setWorkspaceRevision(result.revision)
      lastRemoteSnapshot = { ...submitted, workspaceRevision: result.revision }
      scheduledPersistAt.value = null
    }
  }

  function persistWorkspace(): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer)
      saveTimer = null
    }
    scheduledPersistAt.value = null
    persistRequested = true

    if (persistPromise) {
      return persistPromise
    }

    persistPromise = (async () => {
      isPersisting.value = true
      try {
        while (persistRequested) {
          persistRequested = false
          let result: { success: boolean; error?: string; revision?: number }
          const submitted = deps.serializeWorkspaceState()
          try {
            result = await window.characterArc.saveWorkspace(toIpcPayload(submitted))
          } catch (error) {
            const message = error instanceof Error ? error.message : '保存失败'
            console.error('[workspace] saveWorkspace failed:', error)
            persistenceError.value = message
            persistRequested = false
            return
          }
          if (!result.success) {
            console.error('[workspace] saveWorkspace failed:', result.error)
          }
          const currentRevision = deps.serializeWorkspaceState().workspaceRevision ?? 0
          const newerRemoteArrived = currentRevision > (submitted.workspaceRevision ?? 0)
          if (!result.success && newerRemoteArrived) {
            persistRequested = true
            continue
          }
          persistenceError.value = result.success ? null : result.error ?? '保存失败'
          if (result.success && typeof result.revision === 'number') {
            if (result.revision >= currentRevision) {
              deps.setWorkspaceRevision(result.revision)
              lastRemoteSnapshot = { ...submitted, workspaceRevision: result.revision }
            } else {
              persistRequested = true
            }
          }
          if (!result.success) {
            persistRequested = false
          }
        }
      } finally {
        isPersisting.value = false
        persistPromise = null
      }
    })()

    return persistPromise
  }

  async function persistAppSettings(): Promise<void> {
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer)
      settingsSaveTimer = null
    }
    const result = await window.characterArc.saveAppSettings(toIpcPayload(deps.getSettingsSnapshot()))
    if (!result.success) {
      console.error('[workspace] saveAppSettings failed:', result.error)
      persistenceError.value = result.error ?? '保存失败'
    } else {
      persistenceError.value = null
    }
  }

  function schedulePersist(
    mode: 'fast' | 'autosave' = 'autosave',
    options: { syncWorkspace?: boolean } = {}
  ): void {
    if (!deps.hasHydrated.value) {
      return
    }
    if (options.syncWorkspace !== false) {
      scheduleWorkspaceSync()
    }
    const delay =
      mode === 'fast'
        ? FAST_PERSIST_DELAY_MS
        : resolveAutoSaveDelayMs(deps.getSettingsSnapshot().appSettings.autoSaveInterval)
    const nextPersistAt = Date.now() + delay
    if (mode === 'autosave' && saveTimer && scheduledPersistAt.value !== null) {
      return
    }
    scheduledPersistAt.value = nextPersistAt
    if (saveTimer) {
      window.clearTimeout(saveTimer)
    }
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void persistWorkspace()
    }, delay)
  }

  function scheduleSettingsPersist(options: { flushWorkspace?: boolean } = {}): void {
    if (!deps.hasHydrated.value) return
    if (options.flushWorkspace !== false) {
      scheduleWorkspaceSync()
      // Saving most settings should also flush any queued workspace edits before the app closes.
      schedulePersist('fast')
    }
    if (settingsSaveTimer) {
      window.clearTimeout(settingsSaveTimer)
    }
    settingsSaveTimer = window.setTimeout(() => {
      void persistAppSettings()
    }, SETTINGS_PERSIST_DELAY_MS)
  }

  function handleRemoteWorkspaceSync(payload: unknown): void {
    if (!payload || typeof payload !== 'object') {
      return
    }
    const remote = payload as StoredState
    const local = deps.serializeWorkspaceState()
    if (typeof remote.workspaceRevision === 'number'
      && typeof local.workspaceRevision === 'number'
      && remote.workspaceRevision < local.workspaceRevision) return
    if (workspaceSyncTimer) {
      window.clearTimeout(workspaceSyncTimer)
      workspaceSyncTimer = null
    }
    const chapterConflicts = new Set<string>()
    const merged = lastRemoteSnapshot
      ? mergeRemoteWorkspace(lastRemoteSnapshot, local, remote, (path) => {
          if (path.length === 5 && path[0] === 'workspaces' && path[2] === 'chapters'
            && ['content', 'title', 'summary'].includes(path[4])) {
            chapterConflicts.add(`${path[1]}\u0000${path[3]}`)
          }
        })
      : mergeRemoteWorkspace(local, local, remote)
    for (const key of chapterConflicts) {
      const [projectId, chapterId] = key.split('\u0000')
      const remoteChapter = remote.workspaces?.[projectId]?.chapters.find((chapter) => chapter.id === chapterId)
      const workspace = merged.workspaces?.[projectId]
      if (!remoteChapter || !workspace) continue
      workspace.chapterVersions = [{
        id: `sync-conflict-${crypto.randomUUID()}`,
        chapterId,
        title: remoteChapter.title,
        summary: remoteChapter.summary,
        status: remoteChapter.status,
        wordTarget: remoteChapter.wordTarget,
        content: remoteChapter.content,
        createdAt: new Date().toISOString()
      }, ...(workspace.chapterVersions ?? [])]
    }
    if (chapterConflicts.size) {
      syncConflictNotice.value = { id: Date.now(), chapterCount: chapterConflicts.size }
    }
    merged.workspaceRevision = remote.workspaceRevision
    lastRemoteSnapshot = remote
    isApplyingRemoteWorkspaceSync = true
    try {
      deps.applyRemoteState(merged)
    } finally {
      isApplyingRemoteWorkspaceSync = false
    }
    if (JSON.stringify(merged) !== JSON.stringify(remote)) {
      if (persistPromise) persistRequested = true
      schedulePersist('fast', { syncWorkspace: false })
    }
  }

  function markWorkspaceLoaded(): void {
    lastRemoteSnapshot = deps.serializeWorkspaceState()
  }

  return {
    scheduledPersistAt,
    isPersisting,
    persistenceError,
    syncConflictNotice,
    scheduleWorkspaceSync,
    flushWorkspaceSync,
    persistWorkspace,
    persistAppSettings,
    schedulePersist,
    scheduleSettingsPersist,
    handleRemoteWorkspaceSync,
    markWorkspaceLoaded
  }
}
