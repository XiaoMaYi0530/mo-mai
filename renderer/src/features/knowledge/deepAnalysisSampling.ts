import type { ReferenceDeepAnalysisDimensionId } from '@shared/reference-deep-analysis'

export const DEEP_ANALYSIS_SAMPLE_CHAR_CAP = 36_000

export interface DeepAnalysisSampleResult {
  text: string
  coverageLabel: string
  sampledPositions: number[]
}

type TextSection = {
  label: string
  text: string
  position: number
}

const CHAPTER_HEADING = /^(?:\s{0,4})(?:第[零〇一二两三四五六七八九十百千万0-9]+章|chapter\s+\d+)\s*[^\n]*$/gimu

function splitIntoSections(rawText: string): TextSection[] {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text) return []

  const matches = [...text.matchAll(CHAPTER_HEADING)]
  if (matches.length < 3) {
    const count = Math.min(12, Math.max(3, Math.ceil(text.length / 12_000)))
    const length = Math.ceil(text.length / count)
    return Array.from({ length: count }, (_, index) => ({
      label: `全书区段 ${index + 1}/${count}`,
      text: text.slice(index * length, Math.min(text.length, (index + 1) * length)).trim(),
      position: count === 1 ? 0 : index / (count - 1)
    })).filter((section) => section.text)
  }

  const sections: TextSection[] = []
  const prefix = text.slice(0, matches[0].index).trim()
  if (prefix) sections.push({ label: '序章 / 前言', text: prefix, position: 0 })
  matches.forEach((match, index) => {
    const start = match.index ?? 0
    const end = matches[index + 1]?.index ?? text.length
    sections.push({
      label: match[0].trim(),
      text: text.slice(start, end).trim(),
      position: matches.length === 1 ? 0 : index / (matches.length - 1)
    })
  })
  return sections
}

function evenlySpacedIndexes(length: number, count: number): number[] {
  if (length <= 0 || count <= 0) return []
  if (length <= count) return Array.from({ length }, (_, index) => index)
  return Array.from({ length: count }, (_, index) =>
    Math.round((index / Math.max(1, count - 1)) * (length - 1)))
}

function keywordScore(text: string, keywords: readonly string[]): number {
  return keywords.reduce((score, keyword) => {
    const matches = text.match(new RegExp(keyword, 'giu'))
    return score + (matches?.length ?? 0)
  }, 0)
}

function resolveSelection(sections: TextSection[], dimensions: readonly ReferenceDeepAnalysisDimensionId[]): number[] {
  const selected = new Set<number>()
  const add = (indexes: readonly number[]) => indexes.forEach((index) => selected.add(index))

  if (dimensions.some((dimension) => dimension === 'opening')) {
    add(Array.from({ length: Math.min(4, sections.length) }, (_, index) => index))
  }
  if (dimensions.some((dimension) => ['overview', 'protagonist', 'mainline', 'style'].includes(dimension))) {
    add(evenlySpacedIndexes(sections.length, 7))
  }
  if (dimensions.includes('supporting')) {
    add(sections
      .map((section, index) => ({ index, score: keywordScore(section.text, ['配角', '反派', '同伴', '师父', '敌人', '盟友', '家族', '势力']) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((item) => item.index))
  }
  if (dimensions.includes('worldbuilding')) {
    add(sections
      .map((section, index) => ({ index, score: keywordScore(section.text, ['境界', '等级', '法则', '能力', '功法', '魔法', '世界', '大陆', '宗门', '组织', '资源']) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, 4)
      .map((item) => item.index))
  }

  if (!selected.size) add(evenlySpacedIndexes(sections.length, 6))
  return [...selected].filter((index) => index >= 0 && index < sections.length).sort((a, b) => a - b)
}

/**
 * 按目标拆书维度，从整书中选择开篇、均匀区段和关键词高相关章节。
 * 这是拆书采样的唯一入口，调用方无需知道章节识别和预算裁剪规则。
 */
export function buildDeepAnalysisSample(
  rawText: string,
  dimensions: readonly ReferenceDeepAnalysisDimensionId[],
  maxChars = DEEP_ANALYSIS_SAMPLE_CHAR_CAP
): DeepAnalysisSampleResult {
  const sections = splitIntoSections(rawText)
  if (!sections.length) return { text: '', coverageLabel: '未读取到原文', sampledPositions: [] }

  const indexes = resolveSelection(sections, dimensions)
  const perSectionCap = Math.max(1_200, Math.floor(maxChars / Math.max(1, indexes.length)))
  const samples = indexes.map((index) => {
    const section = sections[index]
    const percent = Math.round(section.position * 100)
    return `【${section.label}｜全书约 ${percent}%】\n${section.text.slice(0, perSectionCap)}`
  })
  const sampledPositions = indexes.map((index) => Math.round(sections[index].position * 100))
  return {
    text: samples.join('\n\n').slice(0, maxChars),
    coverageLabel: `从 ${sections.length} 个章节/区段中抽取 ${indexes.length} 段；位置约 ${sampledPositions.join('%、')}%`,
    sampledPositions
  }
}
