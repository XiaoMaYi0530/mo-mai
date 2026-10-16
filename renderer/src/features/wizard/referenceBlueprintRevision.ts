import type { ReferenceProjectBlueprintResult } from './projectSeed'

export interface BlueprintRevisionEdit {
  target: 'volume' | 'node' | 'chapter'
  action: 'update' | 'insert' | 'delete'
  volumeIndex: number
  nodeIndex?: number
  chapterIndex?: number
  title?: string
  conflict?: string
  summary?: string
}

export interface BlueprintRevisionResult {
  reply: string
  edits: BlueprintRevisionEdit[]
}

export function applyBlueprintRevision(
  source: ReferenceProjectBlueprintResult,
  edits: BlueprintRevisionEdit[]
): ReferenceProjectBlueprintResult {
  if (!edits.length || edits.length > 8) throw new Error('AI 没有返回可应用的修改。')
  const blueprint = structuredClone(source)

  for (const edit of edits) {
    const volumeIndex = edit.volumeIndex
    if (!Number.isInteger(volumeIndex) || volumeIndex < 0 || volumeIndex >= blueprint.outlineVolumes.length) {
      throw new Error('AI 指向了不存在的分卷，请重新描述要修改的位置。')
    }
    const volume = blueprint.outlineVolumes[volumeIndex]
    if (edit.target === 'volume') {
      if (edit.action !== 'update') throw new Error('本次对话仅支持修改分卷目标，不增删分卷。')
      if (edit.title !== undefined) volume.title = edit.title.trim()
      if (edit.summary !== undefined) volume.summary = edit.summary.trim()
      continue
    }

    const nodes = blueprint.outlineItems.filter((item) => item.volumeIndex === volumeIndex)
    const nodeIndex = edit.nodeIndex
    if (!Number.isInteger(nodeIndex) || nodeIndex === undefined || nodeIndex < 0 || nodeIndex > nodes.length) {
      throw new Error('AI 指向了不存在的剧情节点，请重试。')
    }
    if (edit.target === 'node') {
      if (edit.action === 'insert') {
        const nextNode = nodes[nodeIndex]
        let afterCurrentVolume = -1
        for (let index = 0; index < blueprint.outlineItems.length; index += 1) {
          if (blueprint.outlineItems[index].volumeIndex === volumeIndex) afterCurrentVolume = index + 1
        }
        if (afterCurrentVolume < 0) {
          const nextVolume = blueprint.outlineItems.findIndex((item) => item.volumeIndex > volumeIndex)
          afterCurrentVolume = nextVolume >= 0 ? nextVolume : blueprint.outlineItems.length
        }
        const insertAt = nextNode
          ? blueprint.outlineItems.indexOf(nextNode)
          : afterCurrentVolume
        blueprint.outlineItems.splice(insertAt, 0, {
          volumeIndex,
          title: edit.title?.trim() ?? '',
          conflict: edit.conflict?.trim() ?? '',
          summary: edit.summary?.trim() ?? '',
          chapterPlan: []
        })
        continue
      }
      const node = nodes[nodeIndex]
      if (!node) throw new Error('AI 指向了不存在的剧情节点，请重试。')
      if (edit.action === 'delete') blueprint.outlineItems.splice(blueprint.outlineItems.indexOf(node), 1)
      else {
        if (edit.title !== undefined) node.title = edit.title.trim()
        if (edit.conflict !== undefined) node.conflict = edit.conflict.trim()
        if (edit.summary !== undefined) node.summary = edit.summary.trim()
      }
      continue
    }

    if (volumeIndex !== 0) throw new Error('远期分卷暂未规划章节，不能修改章节建议。')
    const node = nodes[nodeIndex]
    if (!node) throw new Error('AI 指向了不存在的剧情节点，请重试。')
    node.chapterPlan ??= []
    const chapterIndex = edit.chapterIndex
    if (!Number.isInteger(chapterIndex) || chapterIndex === undefined || chapterIndex < 0 || chapterIndex > node.chapterPlan.length) {
      throw new Error('AI 指向了不存在的章节建议，请重试。')
    }
    if (edit.action === 'insert') {
      node.chapterPlan.splice(chapterIndex, 0, {
        title: edit.title?.trim() ?? '',
        conflict: edit.conflict?.trim() ?? '',
        summary: edit.summary?.trim() ?? ''
      })
    } else {
      const chapter = node.chapterPlan[chapterIndex]
      if (!chapter) throw new Error('AI 指向了不存在的章节建议，请重试。')
      if (edit.action === 'delete') node.chapterPlan.splice(chapterIndex, 1)
      else {
        if (edit.title !== undefined) chapter.title = edit.title.trim()
        if (edit.conflict !== undefined) chapter.conflict = edit.conflict.trim()
        if (edit.summary !== undefined) chapter.summary = edit.summary.trim()
      }
    }
  }
  return blueprint
}
