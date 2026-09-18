export type ChapterWordCountIssue = {
  severity: 'critical'
  category: 'word-count'
  ref: string
  hint: string
}

export type LocalChapterAuditIssue = ChapterWordCountIssue | {
  severity: 'warning' | 'hint'
  category: 'duplicate-paragraph' | 'prose-style'
  ref: string
  hint: string
}

export type LocalChapterAudit = {
  pass: boolean
  wordCount: number
  issues: LocalChapterAuditIssue[]
}

/** 长章允许后续拆分；只有低于目标 90% 才属于章节审计失败。 */
export function buildChapterWordCountIssue(
  targetWordCount: number,
  measuredWordCount: number
): ChapterWordCountIssue | null {
  const target = Math.max(Number(targetWordCount) || 0, 1)
  const measured = Math.max(Number(measuredWordCount) || 0, 0)
  const minimum = Math.round(target * 0.9)
  if (measured >= minimum) return null

  return {
    severity: 'critical',
    category: 'word-count',
    ref: `程序测量 ${measured} 字，目标 ${target} 字，最低建议 ${minimum} 字`,
    hint: `正文低于目标下限，需要补足约 ${minimum - measured} 字，并优先扩展关键冲突、行动和情绪转折。`
  }
}

/** 最终稿的零模型成本复验。风格命中只提示，不自动改动正文或阻止保存。 */
export function buildLocalChapterAudit(text: string, targetWordCount: number): LocalChapterAudit {
  const trimmed = text.trim()
  const issues: LocalChapterAuditIssue[] = []
  const wordCountIssue = buildChapterWordCountIssue(targetWordCount, trimmed.length)
  if (wordCountIssue) issues.push(wordCountIssue)

  const paragraphs = trimmed.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean)
  const duplicates = paragraphs.length - new Set(paragraphs).size
  if (duplicates > 0) {
    issues.push({
      severity: 'warning',
      category: 'duplicate-paragraph',
      ref: `检测到 ${duplicates} 个完全重复段落`,
      hint: '请确认重复是有意安排；若不是，可在正文中删除重复段落。'
    })
  }

  for (const phrase of ['眼中闪过一丝', '嘴角勾起一抹', '他不知道的是']) {
    if (!trimmed.includes(phrase)) continue
    issues.push({
      severity: 'hint',
      category: 'prose-style',
      ref: phrase,
      hint: '这处表达可能显得模板化；结合人物视角和上下文判断是否需要调整。'
    })
  }

  return {
    pass: !wordCountIssue && duplicates <= 2,
    wordCount: trimmed.length,
    issues
  }
}
