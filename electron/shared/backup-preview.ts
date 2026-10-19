export interface BackupChapter { id: string; volumeId: string; title: string; summary: string; status: 'draft' | 'review' | 'polish' | 'final'; wordTarget: string; content: string }
export interface BackupChapterVersion { id: string; chapterId: string; title: string; summary: string; status: BackupChapter['status']; wordTarget: string; content: string; createdAt: string }
export interface BackupCatalog { projects: Array<{ id: string; title: string; chapters: Array<{ id: string; title: string; volumeId: string; volumeTitle: string; characters: number }> }> }
export interface BackupVolume { id: string; title: string; summary: string; wordTarget: string }
export interface BackupChapterSelection { chapters: BackupChapter[]; versions: BackupChapterVersion[]; volumes?: BackupVolume[] }
/** New identities and draft status keep recovered prose independent of current outlines/game events. */
export function copyBackupChapters(selection: BackupChapterSelection, volumeId: string, id: () => string) {
  const mapping = new Map(selection.chapters.map(c => [c.id, id()]))
  return {
    chapters: selection.chapters.map(c => ({ ...c, id: mapping.get(c.id)!, volumeId, outlineItemId: '', status: 'draft' as const })),
    chapterVersions: selection.versions.filter(v => mapping.has(v.chapterId)).map(v => ({ ...v, id: id(), chapterId: mapping.get(v.chapterId)! }))
  }
}

/** Restore only selected chapters, retaining their source volumes and volume order. */
export function copyBackupProjectChapters(selection: BackupChapterSelection, id: () => string) {
  const used = new Set(selection.chapters.map(c => c.volumeId))
  const volumes = (selection.volumes ?? []).filter(v => used.has(v.id))
  for (const volumeId of used) if (!volumes.some(v => v.id === volumeId)) volumes.push({ id: volumeId, title: '恢复章节', summary: '', wordTarget: '' })
  const groups = volumes.map(volume => {
    const volumeId = id()
    const copied = copyBackupChapters({ chapters: selection.chapters.filter(c => c.volumeId === volume.id), versions: selection.versions }, volumeId, id)
    return { volume: { ...volume, id: volumeId }, ...copied }
  })
  return { outlineVolumes: groups.map(g => g.volume), chapters: groups.flatMap(g => g.chapters), chapterVersions: groups.flatMap(g => g.chapterVersions) }
}
