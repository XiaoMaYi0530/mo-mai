export interface ComparableOutlineItem {
  id: string
  volumeId: string
  title: string
  wordTarget?: string
  conflict?: string
  summary: string
  relatedCharacterIds?: string[]
  relatedOrganizationIds?: string[]
  relatedWorldviewIds?: string[]
}

export type OutlineCreateResolution<T extends ComparableOutlineItem> =
  | { kind: 'create' }
  | { kind: 'skip'; existing: T }
  | { kind: 'update'; existing: T }

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, '').toLowerCase()
}

function normalizeIds(value: string[] | undefined): string[] {
  return [...new Set(value ?? [])].sort()
}

function sameIds(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = normalizeIds(left)
  const normalizedRight = normalizeIds(right)
  return normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((id, index) => id === normalizedRight[index])
}

function hasSameContent(left: ComparableOutlineItem, right: ComparableOutlineItem): boolean {
  return left.volumeId === right.volumeId &&
    normalizeText(left.title) === normalizeText(right.title) &&
    normalizeText(left.wordTarget) === normalizeText(right.wordTarget) &&
    normalizeText(left.conflict) === normalizeText(right.conflict) &&
    normalizeText(left.summary) === normalizeText(right.summary) &&
    sameIds(left.relatedCharacterIds, right.relatedCharacterIds) &&
    sameIds(left.relatedOrganizationIds, right.relatedOrganizationIds) &&
    sameIds(left.relatedWorldviewIds, right.relatedWorldviewIds)
}

/**
 * 大纲 create 的前置判重：同名且相同则跳过，同名但内容变化则修改已有节点。
 * 最终写回仍保留唯一性校验，作为并发或快照过期时的最后一道防线。
 */
export function resolveOutlineCreate<T extends ComparableOutlineItem>(
  existingItems: T[],
  incoming: ComparableOutlineItem
): OutlineCreateResolution<T> {
  const existing = existingItems.find((item) => normalizeText(item.title) === normalizeText(incoming.title))
  if (!existing) return { kind: 'create' }
  return hasSameContent(existing, incoming)
    ? { kind: 'skip', existing }
    : { kind: 'update', existing }
}
