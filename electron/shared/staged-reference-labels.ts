export interface StagedReferenceCatalog {
  characters?: ReadonlyArray<{ id: string; name: string }>
  organizations?: ReadonlyArray<{ id: string; name: string }>
  worldviewEntries?: ReadonlyArray<{ id: string; title: string }>
  outlineItems?: ReadonlyArray<{ id: string; title: string }>
  outlineVolumes?: ReadonlyArray<{ id: string; title: string }>
  chapters?: ReadonlyArray<{ id: string; title: string }>
}

export type StagedReferenceKind =
  | 'character'
  | 'organization'
  | 'worldview'
  | 'outline'
  | 'volume'
  | 'chapter'

function entriesForKind(
  catalog: StagedReferenceCatalog,
  kind: StagedReferenceKind
): ReadonlyArray<readonly [string, string]> {
  switch (kind) {
    case 'character':
      return (catalog.characters ?? []).map((item) => [item.id, item.name])
    case 'organization':
      return (catalog.organizations ?? []).map((item) => [item.id, item.name])
    case 'worldview':
      return (catalog.worldviewEntries ?? []).map((item) => [item.id, item.title])
    case 'outline':
      return (catalog.outlineItems ?? []).map((item) => [item.id, item.title])
    case 'volume':
      return (catalog.outlineVolumes ?? []).map((item) => [item.id, item.title])
    case 'chapter':
      return (catalog.chapters ?? []).map((item) => [item.id, item.title])
  }
}

function referenceNameMap(
  catalog: StagedReferenceCatalog,
  kind?: StagedReferenceKind
): Map<string, string> {
  const kinds: StagedReferenceKind[] = kind
    ? [kind]
    : ['character', 'organization', 'worldview', 'outline', 'volume', 'chapter']
  return new Map(
    kinds.flatMap((itemKind) => entriesForKind(catalog, itemKind))
      .filter(([id, name]) => id.trim() && name.trim())
  )
}

/** 给新暂存项生成面向用户的关联名称。内部写回 payload 仍保留稳定 ID。 */
export function formatStagedReferenceNames(
  ids: readonly string[],
  catalog: StagedReferenceCatalog,
  kind: StagedReferenceKind
): string {
  const names = referenceNameMap(catalog, kind)
  return ids
    .map((id) => names.get(id) ?? `未找到（${id}）`)
    .join(' / ')
}

/** 兼容旧版已落盘的暂存文本：审阅时把内部 ID 动态显示为实体名称。 */
export function resolveStagedReferenceText(
  text: string,
  catalog: StagedReferenceCatalog
): string {
  if (!text) return text
  let resolved = text
    .replaceAll('关联角色 ID：', '关联人物：')
    .replaceAll('关联组织 ID：', '关联组织：')
    .replaceAll('关联设定 ID：', '关联设定：')

  const entries = [...referenceNameMap(catalog).entries()]
    .sort(([left], [right]) => right.length - left.length)
  for (const [id, name] of entries) {
    resolved = resolved.replaceAll(id, name)
  }
  return resolved
}
