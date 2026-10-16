/** Versioned, project/reference-scoped storage. A failed write never destroys the last draft. */
export interface DraftStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export function creationDraftKey(projectId: string, referenceId: string): string {
  return `mo-mai:creation-draft:v1:${encodeURIComponent(projectId)}:${encodeURIComponent(referenceId)}`
}
export function readCreationDraft<T>(storage: DraftStorage, key: string): { savedAt: string; data: T } | null {
  try {
    const entry = JSON.parse(storage.getItem(key) || 'null')
    if (entry?.version !== 1 || typeof entry.savedAt !== 'string' || !entry.data?.form
      || typeof entry.data.form.title !== 'string' || !Array.isArray(entry.data.referencePlan?.auxiliaries)) return null
    return { savedAt: entry.savedAt, data: entry.data }
  } catch { return null }
}
export function writeCreationDraft(storage: DraftStorage, key: string, data: unknown): string {
  const savedAt = new Date().toISOString()
  storage.setItem(key, JSON.stringify({ version: 1, savedAt, data }))
  return savedAt
}
