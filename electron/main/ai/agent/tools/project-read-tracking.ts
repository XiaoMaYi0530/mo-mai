import type { ProjectReadReceipt, ReadItem } from '../../../../shared/project-read-receipt.ts'

export interface CharacterReadRow { id: string; name: string; role: string; description: string }
/** Bounded text batches including segments of long cards. Cursor is a stable segment offset within one turn snapshot. */
export function characterReadBatches(rows: CharacterReadRow[]) {
  const chunks: Array<{ item: ReadItem; body: string }> = []
  for (const row of rows) {
    const content = `${row.role ? `定位：${row.role}\n` : ''}${row.description || ''}`
    for (let from = 0; from < Math.max(1, content.length); from += 10000) {
      const to = Math.min(from + 10000, content.length)
      chunks.push({ item: { id: row.id, title: row.name, mode: from === 0 && to === content.length ? 'full' : 'partial', from, to, total: content.length },
        body: `# ${row.name} [${row.id}]（${from}–${to} / ${content.length}）\n${content.slice(from,to)}` })
    }
  }
  const batches: Array<{ receipt: ProjectReadReceipt; body: string }> = []
  for (let i=0;i<Math.max(1,chunks.length);i+=2) {
    const slice = chunks.slice(i,i+2)
    batches.push({ receipt: { module: 'characters', total: rows.length, items: slice.map(x=>x.item),
      ...(i===0 ? {catalog:rows.map(row=>({id:row.id,title:row.name}))}:{}),
      ...(i+2<chunks.length ? {nextCursor: batches.length+1}: {}) }, body:slice.map(x=>x.body).join('\n\n') || '本项目没有人物卡。' })
  }
  return batches
}
