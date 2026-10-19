import type { ChapterDraft, OutlineItem, ProjectWorkspaceData } from '../../types/app'
import { moveOutlineItemsToVolumeEnd, moveOutlineItemsAroundTarget, type OutlineDropPosition } from './outlineReorder.ts'

type Placement = { id: string; volumeId: string }
export interface OutlineTransferUndo {
  outlines: Placement[]
  chapters: Placement[]
  after: string
}
function placementSignature(workspace: Pick<ProjectWorkspaceData, 'outlineItems' | 'chapters'>): string {
  return JSON.stringify([workspace.outlineItems, workspace.chapters].map(rows => rows.map(({ id, volumeId }) => [id, volumeId])))
}
/** Move linked chapters atomically; undo restores placement only, never old prose. */
export function transferOutlineNodes(workspace: ProjectWorkspaceData, ids: string[], target: string, withChapters: boolean, anchor?: { id: string; position: OutlineDropPosition }) {
  if (!workspace.outlineVolumes.some(volume => volume.id === target)) throw new Error('目标分卷不存在。')
  const selected = new Set(ids)
  const moving = new Set(workspace.outlineItems.filter(item => selected.has(item.id)).map(item => item.id))
  const ordered = anchor && workspace.outlineItems.some(item => item.id === anchor.id && item.volumeId === target && !moving.has(item.id))
    ? moveOutlineItemsAroundTarget(workspace.outlineItems, [...moving], anchor.id, anchor.position)
    : moveOutlineItemsToVolumeEnd(workspace.outlineItems, [...moving], target, workspace.outlineVolumes.map(v => v.id))
  const outlineItems = ordered
    .map((item, sortOrder) => ({ ...item, sortOrder }))
  let chapters = workspace.chapters
  const movedChapters = withChapters ? chapters.filter(c => moving.has(c.outlineItemId)) : []
  if (movedChapters.length) {
    const moved = new Set(movedChapters.map(c => c.id))
    const remaining = chapters.filter(c => !moved.has(c.id))
    const targetIndex = workspace.outlineVolumes.findIndex(v => v.id === target)
    const volumeOrder = new Map(workspace.outlineVolumes.map((v, i) => [v.id, i]))
    let insert = remaining.findIndex(c => (volumeOrder.get(c.volumeId) ?? Infinity) > targetIndex)
    if (insert < 0) insert = remaining.length
    if (anchor) {
      const indexes = remaining.map((chapter,index) => chapter.outlineItemId === anchor.id ? index : -1).filter(index => index >= 0)
      if (indexes.length) insert = anchor.position === 'before' ? indexes[0] : indexes.at(-1)! + 1
    }
    chapters = [...remaining.slice(0, insert), ...movedChapters.map(c => ({ ...c, volumeId: target })), ...remaining.slice(insert)]
  }
  const next = { ...workspace, outlineItems, chapters }
  const undo: OutlineTransferUndo = {
    outlines: workspace.outlineItems.map(({ id, volumeId }) => ({ id, volumeId })),
    chapters: workspace.chapters.map(({ id, volumeId }) => ({ id, volumeId })),
    after: placementSignature(next)
  }
  return { workspace: next, undo, nodeCount: moving.size, chapterCount: movedChapters.length }
}
export function undoOutlineTransfer(workspace: ProjectWorkspaceData, undo: OutlineTransferUndo): ProjectWorkspaceData | null {
  if (placementSignature(workspace) !== undo.after) return null
  const volumes = new Set(workspace.outlineVolumes.map(v => v.id))
  if ([...undo.outlines, ...undo.chapters].some(p => !volumes.has(p.volumeId))) return null
  function restore<T extends OutlineItem | ChapterDraft>(rows: T[], positions: Placement[]): T[] {
    const byId = new Map(rows.map(row => [row.id, row]))
    return positions.map(p => ({ ...byId.get(p.id)!, volumeId: p.volumeId }))
  }
  return { ...workspace, outlineItems: restore(workspace.outlineItems, undo.outlines).map((item, sortOrder) => ({ ...item, sortOrder })),
    chapters: restore(workspace.chapters, undo.chapters) }
}
