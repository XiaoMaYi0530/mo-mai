import { basename, extname } from 'node:path'
import { readFile } from 'node:fs/promises'

export type ReferenceFileType = 'txt' | 'md' | 'docx'

export type ReferenceStyleMetric = {
  label: string
  value: string
}

export type ReferenceNovelChunk = {
  id: string
  label: string
  order: number
  text: string
  characterCount: number
  topKeywords: string[]
  metrics: ReferenceStyleMetric[]
}

export type ReferenceNovelLocalContext = {
  title: string
  fileName: string
  fileType: ReferenceFileType
  /** 已完成编码识别、可直接持久化和送入 AI 的规范化全文。 */
  sourceText: string
  excerpt: string
  analysisSample: string
  characterCount: number
  chapterCount: number
  topKeywords: string[]
  metrics: ReferenceStyleMetric[]
  analysisChunks: ReferenceNovelChunk[]
}

export type DecodedReferenceNovel = {
  text: string
  encoding: 'UTF-8 BOM' | 'UTF-8' | 'UTF-16 LE' | 'UTF-16 BE' | 'GB18030'
}

type JiebaRuntime = {
  jieba: {
    cut(text: string, hmm?: boolean): string[]
  }
  tfidf: {
    extractKeywords(
      jieba: { cut(text: string, hmm?: boolean): string[] },
      text: string,
      limit: number
    ): Array<{ keyword: string }>
  }
}

let jiebaRuntimePromise: Promise<JiebaRuntime> | null = null
const CHAPTER_HEADING_RE = /^(第[0-9零一二三四五六七八九十百千万两]+[章节回卷部集][^\n]{0,40})$/gm
const MAX_ANALYSIS_CHUNKS = 12
const MAX_CHUNK_CHAR_COUNT = 6_000
const CHUNK_KEYWORD_LIMIT = 8
const KEYWORD_TEXT_CLIP = 36_000
const KEYWORD_MAX_LENGTH = 10
const STOP_WORDS = new Set([
  '一个',
  '一种',
  '一些',
  '没有',
  '他们',
  '自己',
  '这个',
  '那个',
  '这里',
  '那里',
  '我们',
  '你们',
  '不是',
  '然后',
  '已经',
  '可以',
  '因为',
  '所以',
  '而且',
  '只是',
  '还是',
  '如果',
  '但是',
  '开始',
  '时候',
  '东西',
  '什么',
  '怎么',
  '一个人',
  '一下',
  '出来',
  '进去',
  '之后',
  '之前',
  '起来',
  '下来',
  '现在',
  '真的',
  '有些',
  '这种',
  '那种',
  '自己人',
  '这时候',
  '那时候',
  '这东西',
  '那东西',
  '这地方',
  '那地方',
  '什么事',
  '怎么会',
  '为什么',
  '不用说',
  '说什么',
  '看着',
  '看向',
  '盯着',
  '听到',
  '说道',
  '问道',
  '笑道',
  '开口',
  '发现',
  '觉得',
  '感觉',
  '知道',
  '明白',
  '继续',
  '直接',
  '慢慢',
  '瞬间',
  '片刻',
  '身上',
  '身体',
  '目光',
  '眼神',
  '脸色',
  '声音',
  '问题',
  '事情',
  '地方'
])

const GENERIC_KEYWORD_RE = /^(说道|问道|笑道|看着|看向|盯着|听到|发现|觉得|感觉|知道|明白|继续|直接|慢慢|瞬间|片刻|身上|身体|目光|眼神|脸色|声音|问题|事情|地方|时候|东西|什么|怎么|如果|因为|所以|但是|然后|已经|还是|可以|不是|没有)$/u
const CHAPTER_TOKEN_RE = /^第?[0-9零一二三四五六七八九十百千万两]+[章节回卷部集]$/u

function normalizeKeywordCandidate(value: string): string {
  return value
    .replace(/[《》〈〉【】〔〕（）()“”"'`~!@#$%^&*+=|\\/:;,.?，。！？；、】【\[\]\s]+/g, '')
    .trim()
}

function isValidKeywordCandidate(keyword: string): boolean {
  if (!keyword || keyword.length < 2 || keyword.length > KEYWORD_MAX_LENGTH) {
    return false
  }

  if (STOP_WORDS.has(keyword) || GENERIC_KEYWORD_RE.test(keyword) || CHAPTER_TOKEN_RE.test(keyword)) {
    return false
  }

  if (/^\d+$/.test(keyword) || /^[A-Za-z0-9]{1,2}$/.test(keyword)) {
    return false
  }

  if (!/^[\p{Script=Han}A-Za-z0-9·_-]+$/u.test(keyword)) {
    return false
  }

  if (!/[\p{Script=Han}A-Za-z]/u.test(keyword)) {
    return false
  }

  if (/([^\d])\1\1/u.test(keyword)) {
    return false
  }

  if (
    (keyword.startsWith('这个') || keyword.startsWith('那个') || keyword.startsWith('一种') || keyword.startsWith('一个'))
    || (keyword.endsWith('时候') || keyword.endsWith('一下') || keyword.endsWith('出来') || keyword.endsWith('进去'))
  ) {
    return false
  }

  return true
}

function selectDistinctKeywords(
  candidates: Array<{ keyword: string; score: number; frequency: number }>,
  limit: number
): string[] {
  const selected: string[] = []

  for (const candidate of candidates) {
    if (selected.length >= limit) {
      break
    }

    const duplicatedByLongerKeyword = selected.some((existing) =>
      (existing.includes(candidate.keyword) || candidate.keyword.includes(existing))
      && Math.abs(existing.length - candidate.keyword.length) <= 2
    )

    if (duplicatedByLongerKeyword) {
      continue
    }

    selected.push(candidate.keyword)
  }

  return selected
}

async function getJiebaRuntime(): Promise<JiebaRuntime> {
  if (!jiebaRuntimePromise) {
    jiebaRuntimePromise = (async () => {
      const [{ Jieba, TfIdf }, { dict, idf }] = await Promise.all([
        import('@node-rs/jieba'),
        import('@node-rs/jieba/dict.js')
      ])

      return {
        jieba: Jieba.withDict(dict),
        tfidf: TfIdf.withDict(idf)
      }
    })()
  }

  return jiebaRuntimePromise
}

function resolveFileType(filePath: string): ReferenceFileType {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.docx') {
    return 'docx'
  }

  if (extension === '.md' || extension === '.markdown') {
    return 'md'
  }

  return 'txt'
}

function normalizeNovelText(rawText: string): string {
  return rawText
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function decodeWith(buffer: Buffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer)
  } catch {
    return null
  }
}

/** TXT/Markdown 统一编码入口，避免导入分析和原文存档使用两套解码规则。 */
export function decodeReferenceNovelBuffer(buffer: Buffer): DecodedReferenceNovel {
  if (buffer.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    return { text: normalizeNovelText(buffer.subarray(3).toString('utf8')), encoding: 'UTF-8 BOM' }
  }
  if (buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    return {
      text: normalizeNovelText(new TextDecoder('utf-16le').decode(buffer.subarray(2))),
      encoding: 'UTF-16 LE'
    }
  }
  if (buffer.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    return {
      text: normalizeNovelText(new TextDecoder('utf-16be').decode(buffer.subarray(2))),
      encoding: 'UTF-16 BE'
    }
  }

  const utf8Text = decodeWith(buffer, 'utf-8')
  if (utf8Text !== null) {
    return { text: normalizeNovelText(utf8Text), encoding: 'UTF-8' }
  }

  const gb18030Text = decodeWith(buffer, 'gb18030')
  if (gb18030Text !== null) {
    return { text: normalizeNovelText(gb18030Text), encoding: 'GB18030' }
  }

  throw new Error('无法识别 TXT 文件编码，请将文件转换为 UTF-8 或 GB18030 后重新导入。')
}

/** 风格指纹是高成本任务；明显乱码必须在调用模型之前快速失败。 */
export function assertReferenceTextUsable(text: string): void {
  const sample = text.slice(0, 80_000)
  const replacementCount = (sample.match(/�/g) ?? []).length
  const replacementRatio = sample.length ? replacementCount / sample.length : 0
  const mojibakeCount = (sample.match(/(?:锟斤拷|烫烫烫|屯屯屯|Ã.|Â.|â€)/g) ?? []).length

  if ((replacementCount >= 8 && replacementRatio >= 0.01) || mojibakeCount >= 8) {
    throw new Error('参考小说原文编码损坏，无法可靠提取风格指纹。请删除该参考资产，并用原始 UTF-8 或 GB18030 文件重新导入。')
  }
}

async function readNovelText(filePath: string, fileType: ReferenceFileType): Promise<string> {
  if (fileType === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ path: filePath })
    return normalizeNovelText(result.value)
  }

  const buffer = await readFile(filePath)
  return decodeReferenceNovelBuffer(buffer).text
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function splitChapters(text: string): string[] {
  const matches = Array.from(text.matchAll(CHAPTER_HEADING_RE))
  if (matches.length >= 3) {
    return matches
      .map((match, index) => {
        const start = match.index ?? 0
        const end = matches[index + 1]?.index ?? text.length
        return text.slice(start, end).trim()
      })
      .filter(Boolean)
  }

  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) {
    return []
  }

  const chunks: string[] = []
  let current = ''

  for (const paragraph of paragraphs) {
    if ((current + '\n\n' + paragraph).length > 2600 && current.trim()) {
      chunks.push(current.trim())
      current = paragraph
      continue
    }

    current = current ? `${current}\n\n${paragraph}` : paragraph
  }

  if (current.trim()) {
    chunks.push(current.trim())
  }

  return chunks
}

function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trim()}……`
}

function buildAnalysisSample(chapters: string[], text: string): string {
  const sourceSections = chapters.length >= 3
    ? [chapters[0], chapters[Math.floor(chapters.length / 2)], chapters[chapters.length - 1]]
    : [
        text.slice(0, 2200),
        text.slice(Math.max(0, Math.floor(text.length / 2) - 1100), Math.max(0, Math.floor(text.length / 2) - 1100) + 2200),
        text.slice(Math.max(0, text.length - 2200))
      ]

  return sourceSections
    .map((section, index) => {
      const label = index === 0 ? '开篇样本' : index === 1 ? '中段样本' : '后段样本'
      return `【${label}】\n${clipText(section.trim(), 2200)}`
    })
    .join('\n\n')
}

function computeMetrics(text: string, chapters: string[]): ReferenceStyleMetric[] {
  const plainText = text.replace(/\s+/g, '')
  const characterCount = plainText.length
  const paragraphs = splitParagraphs(text)
  const sentences = text
    .split(/[。！？!?；;]+/)
    .map((sentence) => sentence.replace(/\s+/g, '').trim())
    .filter(Boolean)
  const dialogueParagraphCount = paragraphs.filter((paragraph) => /[“”「」『』"']/u.test(paragraph)).length
  const shortSentenceCount = sentences.filter((sentence) => sentence.length <= 18).length
  const emotionMarkCount = (text.match(/[!?！？]/g) ?? []).length
  const avgSentenceLength = sentences.length ? plainText.length / sentences.length : 0
  const dialogueParagraphRatio = paragraphs.length ? dialogueParagraphCount / paragraphs.length : 0
  const shortSentenceRatio = sentences.length ? shortSentenceCount / sentences.length : 0
  const emotionMarksPerThousand = characterCount ? (emotionMarkCount / characterCount) * 1000 : 0

  return [
    { label: '总字数', value: `${characterCount.toLocaleString('zh-CN')} 字` },
    { label: '章节估计', value: `${Math.max(chapters.length, 1)} 段/章` },
    { label: '平均句长', value: `${avgSentenceLength.toFixed(1)} 字/句` },
    { label: '对白段落占比', value: `${(dialogueParagraphRatio * 100).toFixed(0)}%` },
    { label: '短句比例', value: `${(shortSentenceRatio * 100).toFixed(0)}%` },
    { label: '情绪标点密度', value: `每千字 ${emotionMarksPerThousand.toFixed(1)} 个` }
  ]
}

async function extractKeywords(text: string, limit = 10): Promise<string[]> {
  const { jieba, tfidf } = await getJiebaRuntime()
  const clippedText = clipText(text, KEYWORD_TEXT_CLIP)
  const tfidfKeywords = tfidf.extractKeywords(jieba, clippedText, Math.max(limit * 3, 24))
  const tokenFrequency = new Map<string, number>()

  for (const token of jieba.cut(clippedText, false)) {
    const normalized = normalizeKeywordCandidate(token)
    if (!isValidKeywordCandidate(normalized)) {
      continue
    }
    tokenFrequency.set(normalized, (tokenFrequency.get(normalized) ?? 0) + 1)
  }

  const scoreMap = new Map<string, { keyword: string; score: number; frequency: number }>()

  tfidfKeywords.forEach((entry, index) => {
    const keyword = normalizeKeywordCandidate(entry.keyword)
    if (!isValidKeywordCandidate(keyword)) {
      return
    }

    const current = scoreMap.get(keyword) ?? { keyword, score: 0, frequency: tokenFrequency.get(keyword) ?? 0 }
    current.score += Math.max(0, 30 - index)
    scoreMap.set(keyword, current)
  })

  for (const [keyword, frequency] of tokenFrequency.entries()) {
    const current = scoreMap.get(keyword) ?? { keyword, score: 0, frequency }
    current.frequency = frequency
    current.score += frequency * 4
    current.score += Math.min(keyword.length, 6)
    if (/^[\p{Script=Han}]{3,6}$/u.test(keyword)) {
      current.score += 3
    }
    if (clippedText.length > 12_000 && frequency < 2) {
      current.score -= 3
    }
    scoreMap.set(keyword, current)
  }

  const ranked = Array.from(scoreMap.values())
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      if (right.frequency !== left.frequency) return right.frequency - left.frequency
      return right.keyword.length - left.keyword.length
    })

  return selectDistinctKeywords(ranked, limit)
}

function mergeSectionsIntoChunks(sections: string[]): string[] {
  if (sections.length === 0) {
    return []
  }

  const merged: string[] = []
  let current = ''

  for (const section of sections) {
    if (section.length > MAX_CHUNK_CHAR_COUNT) {
      if (current.trim()) {
        merged.push(current.trim())
        current = ''
      }

      for (let index = 0; index < section.length; index += MAX_CHUNK_CHAR_COUNT) {
        const slice = section.slice(index, index + MAX_CHUNK_CHAR_COUNT).trim()
        if (slice) {
          merged.push(slice)
        }
      }
      continue
    }

    const candidate = current ? `${current}\n\n${section}` : section
    if (candidate.length > MAX_CHUNK_CHAR_COUNT && current.trim()) {
      merged.push(current.trim())
      current = section
      continue
    }

    current = candidate
  }

  if (current.trim()) {
    merged.push(current.trim())
  }

  return merged
}

function pickRepresentativeChunkIndexes(total: number): number[] {
  if (total <= MAX_ANALYSIS_CHUNKS) {
    return Array.from({ length: total }, (_, index) => index)
  }

  const indexes = new Set<number>([0, total - 1, Math.floor(total / 2)])
  const step = (total - 1) / (MAX_ANALYSIS_CHUNKS - 1)

  for (let index = 0; index < MAX_ANALYSIS_CHUNKS; index += 1) {
    indexes.add(Math.round(index * step))
  }

  return Array.from(indexes)
    .sort((left, right) => left - right)
    .slice(0, MAX_ANALYSIS_CHUNKS)
}

function buildChunkLabel(index: number, total: number): string {
  if (index === 0) {
    return '开篇段'
  }

  if (index === total - 1) {
    return '收束段'
  }

  const ratio = total <= 1 ? 0 : index / (total - 1)
  if (ratio < 0.34) {
    return '前段'
  }

  if (ratio > 0.66) {
    return '后段'
  }

  return '中段'
}

async function buildAnalysisChunks(chapters: string[]): Promise<ReferenceNovelChunk[]> {
  const mergedChunks = mergeSectionsIntoChunks(chapters)
  const selectedIndexes = pickRepresentativeChunkIndexes(mergedChunks.length)

  return Promise.all(selectedIndexes.map(async (chunkIndex, order) => {
    const text = mergedChunks[chunkIndex]
    const plainText = text.replace(/\s+/g, '')
    const label = `${buildChunkLabel(chunkIndex, mergedChunks.length)} ${chunkIndex + 1}/${mergedChunks.length}`
    return {
      id: `chunk-${chunkIndex + 1}`,
      label,
      order,
      text,
      characterCount: plainText.length,
      topKeywords: await extractKeywords(text, CHUNK_KEYWORD_LIMIT),
      metrics: computeMetrics(text, [text])
    }
  }))
}

export async function extractReferenceNovelContext(filePath: string): Promise<ReferenceNovelLocalContext> {
  const fileType = resolveFileType(filePath)
  const fileName = basename(filePath)
  const title = basename(filePath, extname(filePath)).trim() || '未命名参考作品'
  const text = await readNovelText(filePath, fileType)
  assertReferenceTextUsable(text)

  if (!text.trim()) {
    throw new Error('导入的文件没有可用正文，请确认文件内容不是空白。')
  }

  const chapters = splitChapters(text)
  const excerpt = clipText(chapters[0] ?? text, 800)
  const [topKeywords, analysisChunks] = await Promise.all([
    extractKeywords(text),
    buildAnalysisChunks(chapters)
  ])

  return {
    title,
    fileName,
    fileType,
    sourceText: text,
    excerpt,
    analysisSample: buildAnalysisSample(chapters, text),
    characterCount: text.replace(/\s+/g, '').length,
    chapterCount: Math.max(chapters.length, 1),
    topKeywords,
    metrics: computeMetrics(text, chapters),
    analysisChunks
  }
}
