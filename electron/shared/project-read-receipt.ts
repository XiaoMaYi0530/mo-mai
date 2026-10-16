/** Read receipts describe tool-delivered text, not a claim that a model understood it. */
export interface ReadItem { id: string; title: string; mode: 'summary' | 'full' | 'partial'; from: number; to: number; total: number }
export interface ProjectReadReceipt { module: string; total: number; items: ReadItem[]; catalog?: Array<{ id: string; title: string }>; nextCursor?: number }
const PREFIX = 'MO_MAI_READ_RECEIPT '
export function encodeReadReceipt(receipt: ProjectReadReceipt, body: string): string { return PREFIX + JSON.stringify(receipt) + '\n' + body }
export function decodeReadReceipt(content: string): { receipt?: ProjectReadReceipt; body: string } {
  if (!content.startsWith(PREFIX)) return { body: content }
  const end = content.indexOf('\n')
  try {
    const receipt = JSON.parse(content.slice(PREFIX.length, end))
    if (typeof receipt.module !== 'string' || !Array.isArray(receipt.items) || !Number.isFinite(receipt.total)) return { body: content }
    return { receipt, body: content.slice(end + 1) }
  } catch { return { body: content } }
}
export function summarizeReadReceipts(receipts: ProjectReadReceipt[]) {
  const groups = new Map<string, { module: string; total: number; catalog: Map<string, string>; items: Map<string, ReadItem[]> }>()
  for (const receipt of receipts) {
    const group = groups.get(receipt.module) ?? { module: receipt.module, total: 0, catalog: new Map(), items: new Map() }
    group.total = Math.max(group.total, receipt.total)
    for (const item of receipt.catalog ?? []) group.catalog.set(item.id, item.title)
    for (const item of receipt.items) { group.items.set(item.id, [...(group.items.get(item.id) ?? []), item]); group.catalog.set(item.id, item.title) }
    groups.set(receipt.module, group)
  }
  return [...groups.values()].map(group => {
    const items = [...group.catalog].map(([id, title]) => {
      const reads = group.items.get(id) ?? []
      const windows = reads.filter(r => r.mode !== 'summary').sort((a,b) => a.from-b.from)
      let covered = 0
      for (const window of windows) { if (window.from > covered) break; covered = Math.max(covered, window.to) }
      const total = Math.max(0, ...reads.map(r => r.total))
      const mode = reads.some(r => r.mode === 'full') || (windows.length > 0 && covered >= total) ? 'full'
        : windows.length ? 'partial' : reads.length ? 'summary' : 'unread'
      return { id, title, mode }
    })
    group.total = Math.max(group.total, items.length)
    const full = items.filter(i => i.mode === 'full').length
    return { module: group.module, total: group.total, full, remaining: Math.max(0,group.total-full), items }
  })
}
