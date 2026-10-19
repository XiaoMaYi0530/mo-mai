export interface ReferenceUsage { referenceWorkId: string; role: 'main' | 'auxiliary'; purpose: 'pacing' | 'plot' | 'relationships' | 'world'; boundary: string }
export const REFERENCE_PURPOSE_LABELS = { pacing: '叙事节奏', plot: '冲突与桥段', relationships: '人物关系', world: '世界规则' }
export function normalizeReferenceUsage(value: unknown): ReferenceUsage[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const rows: ReferenceUsage[] = []
  for (const row of value) {
    if (!row || typeof row.referenceWorkId !== 'string' || !row.referenceWorkId.trim() || seen.has(row.referenceWorkId.trim()) || !Object.hasOwn(REFERENCE_PURPOSE_LABELS, row.purpose)) continue
    seen.add(row.referenceWorkId.trim())
    rows.push({ referenceWorkId: row.referenceWorkId.trim(), role: rows.length === 0 ? 'main' : 'auxiliary', purpose: row.purpose, boundary: typeof row.boundary === 'string' ? row.boundary.slice(0,1000) : '' })
    if (rows.length === 3) break
  }
  return rows
}
export function formatReferenceUsage(value: unknown, works: Array<{ id: string; title: string }>): string {
  const rows = normalizeReferenceUsage(value)
  if (!rows.length) return ''
  return '【作品结构参考分工】仅借指定维度的方法，不复用人物、专有名词或具体情节；文风由独立绑定决定。\n' + rows.map(row => {
    const work = works.find(w => w.id === row.referenceWorkId)
    return work ? `${row.role === 'main' ? '主参考' : '辅助参考'}《${work.title}》[${work.id}]：${REFERENCE_PURPOSE_LABELS[row.purpose]}。边界：${row.boundary || '仅参考该维度，保持原创。'}` : `参考 [${row.referenceWorkId}] 已缺失，不得声称已参考其内容。`
  }).join('\n')
}
