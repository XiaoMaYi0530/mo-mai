export interface ChapterTrashEntry<C, V> {
  id: string
  chapter: C
  versions: V[]
  deletedAt: string
  originalIndex: number
}
/** Restores the same chapter identity so linked records can reconnect. */
export function restoreTrashedChapter<C extends { id: string; volumeId: string; outlineItemId: string }, V extends { id: string }>(
  chapters: C[], versions: V[], entry: ChapterTrashEntry<C,V>, volumeIds: string[], outlineIds: string[]
): { chapters: C[]; versions: V[] } {
  if (chapters.some(c => c.id === entry.chapter.id)) throw new Error('同一章节已存在，无法重复恢复。')
  if (!volumeIds.length) throw new Error('请先建立分卷。')
  const chapter = { ...entry.chapter, volumeId: volumeIds.includes(entry.chapter.volumeId) ? entry.chapter.volumeId : volumeIds[0],
    outlineItemId: outlineIds.includes(entry.chapter.outlineItemId) ? entry.chapter.outlineItemId : '' }
  const next = [...chapters]
  const sameVolume = next.map((c,i) => c.volumeId === chapter.volumeId ? i : -1).filter(i => i >= 0)
  const laterVolumeIndex = next.findIndex(c => volumeIds.indexOf(c.volumeId) > volumeIds.indexOf(chapter.volumeId))
  const index = sameVolume.length ? Math.max(sameVolume[0], Math.min(entry.originalIndex, sameVolume.at(-1)! + 1)) : laterVolumeIndex < 0 ? next.length : laterVolumeIndex
  next.splice(index, 0, chapter)
  const existing = new Set(versions.map(v => v.id))
  return { chapters: next, versions: [...versions, ...entry.versions.filter(v => !existing.has(v.id))] }
}
