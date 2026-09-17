import { chapterHtmlToPlainText } from './chapter-text.ts'

export type ChapterReplacementRisk = {
  unsafe: boolean
  sourceLength: number
  searchLength: number
  replacementLength: number
  resultLength: number
}

function compactText(value: string): string {
  return chapterHtmlToPlainText(value).replace(/\s+/g, '')
}

/**
 * 识别“只定位一小句，却把接近整章的新稿塞进该位置”的危险替换。
 * 这种结果通常会形成“新整章 + 旧正文剩余部分”，既会重复正文，也会让 Diff 失真。
 */
export function assessChapterReplacementRisk(input: {
  oldHtml: string
  newHtml: string
  search: string
  replacement: string
}): ChapterReplacementRisk {
  const sourceLength = compactText(input.oldHtml).length
  const resultLength = compactText(input.newHtml).length
  const searchLength = compactText(input.search).length
  const replacementLength = compactText(input.replacement).length

  const unsafe = sourceLength >= 400
    && searchLength > 0
    && searchLength / sourceLength <= 0.2
    && replacementLength / sourceLength >= 0.5
    && replacementLength / searchLength >= 4
    && resultLength / sourceLength >= 1.3

  return { unsafe, sourceLength, searchLength, replacementLength, resultLength }
}

export function hasWholeChapterEditIntent(prompt: string): boolean {
  const instruction = prompt.includes('【用户指令】')
    ? prompt.slice(prompt.lastIndexOf('【用户指令】') + '【用户指令】'.length)
    : prompt
  return /(整章|全章|全文|整篇|整节)[^\n]{0,20}(润色|改写|重写|精简|压缩|优化|调整)|(?:润色|改写|重写|精简|压缩|优化|调整)[^\n]{0,20}(整章|全章|全文|整篇|整节)/.test(
    instruction.replace(/\s+/g, '')
  )
}
