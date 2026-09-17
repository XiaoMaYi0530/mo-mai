export type ReferenceDeepAnalysisDimensionId =
  | 'overview'
  | 'protagonist'
  | 'mainline'
  | 'opening'
  | 'supporting'
  | 'worldbuilding'
  | 'style'

export type ReferenceDeepAnalysisDocumentLike = {
  title?: string
  metadata?: Record<string, unknown>
}

export const REFERENCE_DEEP_ANALYSIS_DIMENSIONS: ReadonlyArray<{
  id: ReferenceDeepAnalysisDimensionId
  label: string
  requiredForCreation: boolean
  recommended: boolean
}> = [
  { id: 'overview', label: '整体总纲', requiredForCreation: true, recommended: true },
  { id: 'protagonist', label: '主角画像', requiredForCreation: false, recommended: true },
  { id: 'mainline', label: '主线骨架', requiredForCreation: true, recommended: true },
  { id: 'opening', label: '黄金开篇', requiredForCreation: false, recommended: true },
  { id: 'supporting', label: '关键配角与反派', requiredForCreation: false, recommended: false },
  { id: 'worldbuilding', label: '世界观与力量体系', requiredForCreation: false, recommended: false },
  { id: 'style', label: '风格指纹', requiredForCreation: false, recommended: false }
]

const DIMENSION_IDS = new Set(REFERENCE_DEEP_ANALYSIS_DIMENSIONS.map((item) => item.id))

export function resolveReferenceDeepAnalysisDimension(
  document: ReferenceDeepAnalysisDocumentLike
): ReferenceDeepAnalysisDimensionId | null {
  const metadataId = String(document.metadata?.analysisDimension ?? '').trim()
  if (DIMENSION_IDS.has(metadataId as ReferenceDeepAnalysisDimensionId)) {
    return metadataId as ReferenceDeepAnalysisDimensionId
  }
  if (String(document.metadata?.documentKind ?? '') === 'author-fingerprint') return 'style'

  const title = String(document.title ?? '')
  if (/作者风格指纹|风格指纹|叙事风格/u.test(title)) return 'style'
  if (/黄金三章|黄金开篇|第[一二三123]章.*(?:桥段|拆解)/u.test(title)) return 'opening'
  if (/关键配角|配角|反派/u.test(title)) return 'supporting'
  if (/主角(?:画像|：|:)|主人公/u.test(title)) return 'protagonist'
  if (/主线|故事线骨架|剧情骨架/u.test(title)) return 'mainline'
  if (/世界观|力量体系|设定：|设定:/u.test(title)) return 'worldbuilding'
  if (/深度拆书总纲|整体拆书|拆书总纲/u.test(title)) return 'overview'
  return null
}

export function buildReferenceDeepAnalysisCoverage(
  documents: readonly ReferenceDeepAnalysisDocumentLike[]
) {
  const completedSet = new Set<ReferenceDeepAnalysisDimensionId>()
  for (const document of documents) {
    const dimension = resolveReferenceDeepAnalysisDimension(document)
    if (dimension) completedSet.add(dimension)
  }
  const completedDimensions = REFERENCE_DEEP_ANALYSIS_DIMENSIONS.filter((item) => completedSet.has(item.id))
  const missingDimensions = REFERENCE_DEEP_ANALYSIS_DIMENSIONS.filter((item) => !completedSet.has(item.id))
  const creationReady = REFERENCE_DEEP_ANALYSIS_DIMENSIONS
    .filter((item) => item.requiredForCreation)
    .every((item) => completedSet.has(item.id))
  const recommendedReady = REFERENCE_DEEP_ANALYSIS_DIMENSIONS
    .filter((item) => item.recommended)
    .every((item) => completedSet.has(item.id))

  return {
    completedCount: completedDimensions.length,
    totalCount: REFERENCE_DEEP_ANALYSIS_DIMENSIONS.length,
    percent: Math.round((completedDimensions.length / REFERENCE_DEEP_ANALYSIS_DIMENSIONS.length) * 100),
    creationReady,
    recommendedReady,
    complete: missingDimensions.length === 0,
    completedDimensions,
    missingDimensions,
    completedDimensionIds: completedDimensions.map((item) => item.id),
    missingDimensionIds: missingDimensions.map((item) => item.id)
  }
}

export function buildReferenceDeepAnalysisPlan(
  documents: readonly ReferenceDeepAnalysisDocumentLike[]
) {
  const coverage = buildReferenceDeepAnalysisCoverage(documents)
  const completedLabels = coverage.completedDimensions.map((item) => item.label)
  const targetLabels = coverage.missingDimensions.map((item) => item.label)
  return {
    coverage,
    targetDimensionIds: coverage.missingDimensionIds,
    promptSummary: [
      completedLabels.length ? `已有维度，不要重新生成：${completedLabels.join('、')}。` : '当前没有已完成的深度拆书维度。',
      targetLabels.length ? `本轮只补充：${targetLabels.join('、')}。` : '所有维度均已完成；如用户重试，只更新明确指定的维度。'
    ].join('\n')
  }
}

function normalizeKeyPart(value: string): string {
  return value.toLowerCase().replace(/[\s《》【】|｜:：、，。·._-]+/gu, '')
}

export function buildReferenceDeepAnalysisKey(document: ReferenceDeepAnalysisDocumentLike): string | null {
  const explicit = String(document.metadata?.analysisKey ?? '').trim()
  if (explicit) return explicit
  const dimension = resolveReferenceDeepAnalysisDimension(document)
  if (!dimension) return null
  if (dimension === 'overview' || dimension === 'protagonist' || dimension === 'mainline' || dimension === 'style') {
    return dimension
  }
  const titleKey = normalizeKeyPart(String(document.title ?? ''))
  return titleKey ? `${dimension}:${titleKey}` : dimension
}

export function annotateReferenceDeepAnalysisDocument<T extends ReferenceDeepAnalysisDocumentLike>(
  document: T,
  referenceWorkId = ''
): T {
  const dimension = resolveReferenceDeepAnalysisDimension(document)
  const analysisKey = buildReferenceDeepAnalysisKey(document)
  return {
    ...document,
    metadata: {
      ...(document.metadata ?? {}),
      ...(referenceWorkId ? { referenceWorkId } : {}),
      ...(dimension ? { analysisDimension: dimension } : {}),
      ...(analysisKey ? { analysisKey } : {})
    }
  }
}
