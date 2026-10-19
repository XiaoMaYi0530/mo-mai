export interface BackupChapter { id: string; volumeId: string; title: string; summary: string; status: 'draft' | 'review' | 'polish' | 'final'; wordTarget: string; content: string }
export interface BackupChapterVersion { id: string; chapterId: string; title: string; summary: string; status: BackupChapter['status']; wordTarget: string; content: string; createdAt: string }
export interface BackupCatalog { projects: Array<{ id: string; title: string; chapters: Array<{ id: string; title: string; volumeId: string; volumeTitle: string; characters: number }> }> }
export interface BackupChapterSelection { chapters: BackupChapter[]; versions: BackupChapterVersion[] }
/** New identities and draft status keep recovered prose independent of current outlines/game events. */
export function copyBackupChapters(selection: BackupChapterSelection, volumeId: string, id: () => string) {
  const mapping = new Map(selection.chapters.map(c => [c.id, id()]))
  return {
    chapters: selection.chapters.map(c => ({ ...c, id: mapping.get(c.id)!, volumeId, outlineItemId: '', status: 'draft' as const })),
    chapterVersions: selection.versions.filter(v => mapping.has(v.chapterId)).map(v => ({ ...v, id: id(), chapterId: mapping.get(v.chapterId)! }))
  }
}
