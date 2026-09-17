import {
  chapterHtmlToPlainText,
  normalizeChapterTextContent
} from '../../../../electron/shared/chapter-text.ts'

export type StagedDiffSegment = {
  type: 'context' | 'add' | 'del'
  text: string
}

export type StagedDiffRow = {
  type: 'context' | 'add' | 'del' | 'ellipsis'
  line: string
  segments: StagedDiffSegment[]
}

export type StagedTextDiff = {
  rows: StagedDiffRow[]
  added: string[]
  removed: string[]
  contentChanged: boolean
  formattingChanged: boolean
  beforeParagraphCount: number
  afterParagraphCount: number
}

export type StagedTextDiffMode = 'chapter' | 'line'

function comparisonText(value: string): string {
  return chapterHtmlToPlainText(value)
    .replace(/[\t\u3000 ]+/g, ' ')
    .replace(/\s*\n+\s*/g, '')
    .trim()
}

function sentenceUnits(value: string): string[] {
  const text = comparisonText(value)
  if (!text) return []
  return text.match(/[^。！？!?…]+(?:(?:…{2,})|[。！？!?]+)[”’」』）】]?|[^。！？!?…]+$/g)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [text]
}

function lineUnits(value: string): string[] {
  return chapterHtmlToPlainText(value)
    .split(/\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function unitKey(value: string): string {
  return value.replace(/\s+/g, '')
}

function pushSegment(target: StagedDiffSegment[], type: StagedDiffSegment['type'], text: string): void {
  if (!text) return
  const previous = target[target.length - 1]
  if (previous?.type === type) previous.text += text
  else target.push({ type, text })
}

function inlineDiff(before: string, after: string): {
  before: StagedDiffSegment[]
  after: StagedDiffSegment[]
} {
  const b = Array.from(before)
  const a = Array.from(after)
  if (b.length * a.length > 250_000) {
    return {
      before: [{ type: 'del', text: before }],
      after: [{ type: 'add', text: after }]
    }
  }

  const lcs: number[][] = Array.from({ length: b.length + 1 }, () => new Array<number>(a.length + 1).fill(0))
  for (let i = b.length - 1; i >= 0; i -= 1) {
    for (let j = a.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = b[i] === a[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const beforeSegments: StagedDiffSegment[] = []
  const afterSegments: StagedDiffSegment[] = []
  let i = 0
  let j = 0
  while (i < b.length && j < a.length) {
    if (b[i] === a[j]) {
      pushSegment(beforeSegments, 'context', b[i])
      pushSegment(afterSegments, 'context', a[j])
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      pushSegment(beforeSegments, 'del', b[i])
      i += 1
    } else {
      pushSegment(afterSegments, 'add', a[j])
      j += 1
    }
  }
  while (i < b.length) { pushSegment(beforeSegments, 'del', b[i]); i += 1 }
  while (j < a.length) { pushSegment(afterSegments, 'add', a[j]); j += 1 }
  return { before: beforeSegments, after: afterSegments }
}

function paragraphCount(value: string): number {
  const text = chapterHtmlToPlainText(value)
  if (!text) return 0
  return text.split(/\n+/).map((item) => item.trim()).filter(Boolean).length
}

function collapseContextRows(rows: StagedDiffRow[]): StagedDiffRow[] {
  const result: StagedDiffRow[] = []
  let index = 0
  while (index < rows.length) {
    if (rows[index].type !== 'context') {
      result.push(rows[index])
      index += 1
      continue
    }
    let end = index
    while (end < rows.length && rows[end].type === 'context') end += 1
    const run = rows.slice(index, end)
    if (run.length <= 4) {
      result.push(...run)
    } else {
      result.push(run[0])
      result.push({
        type: 'ellipsis',
        line: `中间 ${run.length - 2} 句未修改`,
        segments: [{ type: 'context', text: `中间 ${run.length - 2} 句未修改` }]
      })
      result.push(run[run.length - 1])
    }
    index = end
  }
  return result
}

/** 正文按句子对齐，其他结构化变更保持逐行对齐。 */
export function buildStagedTextDiff(
  beforeValue: string,
  afterValue: string,
  options: { mode?: StagedTextDiffMode } = {}
): StagedTextDiff {
  const mode = options.mode ?? 'chapter'
  const before = mode === 'chapter' ? sentenceUnits(beforeValue) : lineUnits(beforeValue)
  const after = mode === 'chapter' ? sentenceUnits(afterValue) : lineUnits(afterValue)
  const lcs: number[][] = Array.from({ length: before.length + 1 }, () => new Array<number>(after.length + 1).fill(0))
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = unitKey(before[i]) === unitKey(after[j])
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const rawRows: StagedDiffRow[] = []
  let i = 0
  let j = 0
  while (i < before.length && j < after.length) {
    if (unitKey(before[i]) === unitKey(after[j])) {
      rawRows.push({ type: 'context', line: before[i], segments: [{ type: 'context', text: before[i] }] })
      i += 1
      j += 1
      continue
    }

    const deleted: string[] = []
    const added: string[] = []
    while (i < before.length && j < after.length && unitKey(before[i]) !== unitKey(after[j])) {
      if (lcs[i + 1][j] >= lcs[i][j + 1]) {
        deleted.push(before[i])
        i += 1
      } else {
        added.push(after[j])
        j += 1
      }
    }
    const pairs = Math.min(deleted.length, added.length)
    deleted.forEach((line, index) => {
      const segments = index < pairs ? inlineDiff(line, added[index]).before : [{ type: 'del' as const, text: line }]
      rawRows.push({ type: 'del', line, segments })
    })
    added.forEach((line, index) => {
      const segments = index < pairs ? inlineDiff(deleted[index], line).after : [{ type: 'add' as const, text: line }]
      rawRows.push({ type: 'add', line, segments })
    })
  }
  while (i < before.length) {
    rawRows.push({ type: 'del', line: before[i], segments: [{ type: 'del', text: before[i] }] })
    i += 1
  }
  while (j < after.length) {
    rawRows.push({ type: 'add', line: after[j], segments: [{ type: 'add', text: after[j] }] })
    j += 1
  }

  const beforeParagraphCount = mode === 'chapter' ? paragraphCount(beforeValue) : 0
  const afterParagraphCount = mode === 'chapter' ? paragraphCount(afterValue) : 0
  return {
    rows: collapseContextRows(rawRows),
    added: rawRows.filter((row) => row.type === 'add').map((row) => row.line),
    removed: rawRows.filter((row) => row.type === 'del').map((row) => row.line),
    contentChanged: mode === 'chapter'
      ? normalizeChapterTextContent(beforeValue) !== normalizeChapterTextContent(afterValue)
      : before.map(unitKey).join('\n') !== after.map(unitKey).join('\n'),
    formattingChanged: mode === 'chapter' && beforeParagraphCount !== afterParagraphCount,
    beforeParagraphCount,
    afterParagraphCount
  }
}
