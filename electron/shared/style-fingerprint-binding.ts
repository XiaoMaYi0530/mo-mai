export interface StyleFingerprintBindingEntry {
  referenceWorkId: string
  weight: number
}

export interface ProjectStyleFingerprintBinding {
  version: 1
  primaryReferenceWorkId: string
  primaryWeight: number
  auxiliary: StyleFingerprintBindingEntry[]
}

export interface StyleFingerprintReferenceWork {
  id: string
  title: string
}

export interface StyleFingerprintDocument {
  id: string
  title: string
  content: string
  summary?: string
  sourceType: string
  metadata?: Record<string, unknown>
  createdAt?: string
  updatedAt?: string
}

export interface ResolvedStyleFingerprint {
  referenceWorkId: string
  title: string
  role: 'primary' | 'auxiliary'
  configuredWeight: number
  effectiveWeight: number
  status: 'ready' | 'missing'
  documentId?: string
  extractedAt?: string
}

export const EMPTY_STYLE_FINGERPRINT_BINDING: ProjectStyleFingerprintBinding = {
  version: 1,
  primaryReferenceWorkId: '',
  primaryWeight: 100,
  auxiliary: []
}

function cleanId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function clampWeight(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.min(100, Math.max(1, Math.round(parsed))) : fallback
}

export function normalizeStyleFingerprintBinding(
  value: unknown,
  fallbackReferenceWorkIds: readonly string[] = []
): ProjectStyleFingerprintBinding {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const isExplicitConfiguration = source.version === 1
  let primaryReferenceWorkId = cleanId(source.primaryReferenceWorkId)
  let primaryWeight = clampWeight(source.primaryWeight, 80)
  const auxiliary: StyleFingerprintBindingEntry[] = []
  const seen = new Set<string>()
  if (primaryReferenceWorkId) seen.add(primaryReferenceWorkId)

  if (Array.isArray(source.auxiliary)) {
    for (const raw of source.auxiliary) {
      if (!raw || typeof raw !== 'object') continue
      const item = raw as Record<string, unknown>
      const referenceWorkId = cleanId(item.referenceWorkId)
      if (!referenceWorkId || seen.has(referenceWorkId)) continue
      seen.add(referenceWorkId)
      auxiliary.push({ referenceWorkId, weight: clampWeight(item.weight, 20) })
    }
  }

  // 旧项目没有专门绑定时，沿用原“参考作品”选择，保证升级后行为不突然消失。
  if (!isExplicitConfiguration && !primaryReferenceWorkId && auxiliary.length === 0) {
    const legacyIds = [...new Set(fallbackReferenceWorkIds.map(cleanId).filter(Boolean))]
    primaryReferenceWorkId = legacyIds[0] ?? ''
    if (primaryReferenceWorkId) {
      const remaining = legacyIds.slice(1)
      primaryWeight = remaining.length > 0 ? 80 : 100
      const auxiliaryWeight = remaining.length > 0 ? Math.max(1, Math.floor(20 / remaining.length)) : 0
      auxiliary.push(...remaining.map((referenceWorkId) => ({ referenceWorkId, weight: auxiliaryWeight })))
    }
  }

  if (!primaryReferenceWorkId) return { ...EMPTY_STYLE_FINGERPRINT_BINDING, auxiliary: [] }
  if (auxiliary.length === 0) primaryWeight = 100
  return { version: 1, primaryReferenceWorkId, primaryWeight, auxiliary }
}

export function collectStyleFingerprintReferenceIds(value: unknown): string[] {
  const binding = normalizeStyleFingerprintBinding(value)
  return [binding.primaryReferenceWorkId, ...binding.auxiliary.map((item) => item.referenceWorkId)].filter(Boolean)
}

export function remapStyleFingerprintBinding(
  value: unknown,
  remap: (id: string) => string
): ProjectStyleFingerprintBinding {
  const binding = normalizeStyleFingerprintBinding(value)
  return normalizeStyleFingerprintBinding({
    version: 1,
    primaryReferenceWorkId: binding.primaryReferenceWorkId ? remap(binding.primaryReferenceWorkId) : '',
    primaryWeight: binding.primaryWeight,
    auxiliary: binding.auxiliary.map((item) => ({ ...item, referenceWorkId: remap(item.referenceWorkId) }))
  })
}

export function isStyleFingerprintDocument(document: Pick<StyleFingerprintDocument, 'title' | 'content' | 'sourceType' | 'metadata'>): boolean {
  if (document.sourceType !== 'reference-summary') return false
  return document.metadata?.documentKind === 'author-fingerprint'
    || /作者风格指纹/u.test(document.title)
    || /author_fingerprint/u.test(document.content)
}

function findLatestFingerprint(
  reference: StyleFingerprintReferenceWork,
  documents: readonly StyleFingerprintDocument[]
): StyleFingerprintDocument | undefined {
  const candidates = documents.filter((document) => {
    if (!isStyleFingerprintDocument(document)) return false
    const exactId = cleanId(document.metadata?.referenceWorkId)
    if (exactId) return exactId === reference.id
    return cleanId(document.metadata?.sourceTitle) === reference.title.trim()
  })
  return candidates.sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')))[0]
}

export function buildProjectStyleFingerprintContext(input: {
  binding: unknown
  fallbackReferenceWorkIds?: readonly string[]
  referenceWorks: readonly StyleFingerprintReferenceWork[]
  documents: readonly StyleFingerprintDocument[]
  maxChars?: number
}): { context: string; entries: ResolvedStyleFingerprint[]; warnings: string[] } {
  const binding = normalizeStyleFingerprintBinding(input.binding, input.fallbackReferenceWorkIds)
  const configured = [
    ...(binding.primaryReferenceWorkId ? [{ referenceWorkId: binding.primaryReferenceWorkId, weight: binding.primaryWeight, role: 'primary' as const }] : []),
    ...binding.auxiliary.map((item) => ({ ...item, role: 'auxiliary' as const }))
  ]
  const workById = new Map(input.referenceWorks.map((work) => [work.id, work]))
  const interim = configured.map((item) => {
    const work = workById.get(item.referenceWorkId)
    const document = work ? findLatestFingerprint(work, input.documents) : undefined
    return { item, work, document }
  })
  const readyWeight = interim.reduce((sum, item) => sum + (item.document ? item.item.weight : 0), 0)
  const entries: ResolvedStyleFingerprint[] = interim.map(({ item, work, document }) => ({
    referenceWorkId: item.referenceWorkId,
    title: work?.title || '已删除的参考作品',
    role: item.role,
    configuredWeight: item.weight,
    effectiveWeight: document && readyWeight > 0 ? Math.round(item.weight / readyWeight * 100) : 0,
    status: document ? 'ready' : 'missing',
    documentId: document?.id,
    extractedAt: document?.updatedAt || document?.createdAt
  }))
  const warnings = entries.filter((entry) => entry.status === 'missing').map((entry) => `《${entry.title}》尚未提取风格指纹，本次不会注入。`)
  const maxChars = Math.max(800, input.maxChars ?? 3200)
  const blocks: string[] = []
  let used = 0
  for (const { item, work, document } of interim) {
    if (!work || !document) continue
    const effective = entries.find((entry) => entry.referenceWorkId === item.referenceWorkId)?.effectiveWeight ?? 0
    const heading = `【${item.role === 'primary' ? '主风格' : '辅助风格'} ${effective}%｜${work.title}】`
    const remaining = maxChars - used - heading.length - 2
    if (remaining < 120) break
    const content = String(document.content || document.summary || '').trim().slice(0, remaining)
    if (!content) continue
    blocks.push(`${heading}\n${content}`)
    used += heading.length + content.length + 2
  }
  const context = blocks.length
    ? `以下权重表示表达特征的主次，不得照搬参考作品的专名、人物、情节或原句。\n\n${blocks.join('\n\n')}`
    : ''
  return { context, entries, warnings }
}
