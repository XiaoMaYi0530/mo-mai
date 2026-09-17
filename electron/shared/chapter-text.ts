const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'"
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&([^;]+);/g, (match, entity: string) => {
    if (NAMED_ENTITIES[entity] != null) return NAMED_ENTITIES[entity]
    const decimal = entity.match(/^#(\d+)$/)
    if (decimal) return String.fromCodePoint(Number(decimal[1]))
    const hexadecimal = entity.match(/^#x([\da-f]+)$/i)
    if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal[1], 16))
    return match
  })
}

/** 将编辑器章节 HTML 转成保留叙事结构的纯文本。 */
export function chapterHtmlToPlainText(content: string): string {
  const normalized = String(content ?? '').trim()
  if (!normalized) return ''
  if (!HTML_TAG_PATTERN.test(normalized)) {
    return normalized.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  }

  return decodeHtmlEntities(
    normalized
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<\/(p|div|h[1-6]|blockquote|li|tr|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 忽略空行、缩进和重新分段，仅用于判断正文内容是否实际变化。 */
export function normalizeChapterTextContent(content: string): string {
  return chapterHtmlToPlainText(content).replace(/[\s\u3000]+/g, '').trim()
}

/** 仅描述段落布局，用于在正文内容 Diff 之外单独提示排版变化。 */
export function chapterTextLayoutSignature(content: string): string {
  return chapterHtmlToPlainText(content)
    .split(/\n+/)
    .map((line) => line.replace(/[\s\u3000]+/g, ''))
    .filter(Boolean)
    .join('\n')
}
