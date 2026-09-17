export const STYLE_FINGERPRINT_SAMPLE_CHAR_CAP = 36_000

/**
 * 从整书均匀抽取多段样本，兼顾开头、中段与结尾的稳定文风，同时控制 AI 输入成本。
 * 段落带有位置标记，避免模型把不相邻内容误判为连续章节。
 */
export function buildStyleFingerprintSample(
  rawText: string,
  maxChars = STYLE_FINGERPRINT_SAMPLE_CHAR_CAP,
  segmentCount = 6
): string {
  const text = String(rawText ?? '').replace(/\r\n?/g, '\n').trim()
  if (!text || text.length <= maxChars) return text

  const safeSegmentCount = Math.max(2, Math.floor(segmentCount))
  const segmentLength = Math.max(1, Math.floor(maxChars / safeSegmentCount))
  const maxStart = Math.max(0, text.length - segmentLength)
  const segments: string[] = []

  for (let index = 0; index < safeSegmentCount; index += 1) {
    const ratio = safeSegmentCount === 1 ? 0 : index / (safeSegmentCount - 1)
    const start = Math.min(maxStart, Math.round(maxStart * ratio))
    const end = Math.min(text.length, start + segmentLength)
    const percent = Math.round(ratio * 100)
    segments.push(`【全书位置约 ${percent}% · 抽样 ${index + 1}/${safeSegmentCount}】\n${text.slice(start, end)}`)
  }

  return segments.join('\n\n')
}
