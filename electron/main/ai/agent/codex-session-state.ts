import type { AiRunUsage } from '../shared-types'

export type CodexSessionObservation = {
  tool: string
  arguments: Record<string, unknown>
  content: string
  isError: boolean
}

export function stableCodexValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableCodexValue).join(',')}]`
  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableCodexValue(object[key])}`).join(',')}}`
}

/** Codex resume 返回会话累计快照；采用最新字段，禁止把累计值再次相加。 */
export function mergeCodexSessionUsageSnapshot(
  previous: AiRunUsage | undefined,
  latestSnapshot: AiRunUsage | undefined
): AiRunUsage | undefined {
  if (!latestSnapshot) return previous
  if (!previous) return latestSnapshot
  const latest = (oldValue?: number, newValue?: number): number | undefined => (
    newValue === undefined ? oldValue : newValue
  )
  return {
    promptTokens: latest(previous.promptTokens, latestSnapshot.promptTokens),
    completionTokens: latest(previous.completionTokens, latestSnapshot.completionTokens),
    totalTokens: latest(previous.totalTokens, latestSnapshot.totalTokens),
    reasoningTokens: latest(previous.reasoningTokens, latestSnapshot.reasoningTokens),
    cachedInputTokens: latest(previous.cachedInputTokens, latestSnapshot.cachedInputTokens)
  }
}

/** Resume 会话已持有原始请求，续接轮只发送新增工具观察，避免再次注入长篇原文。 */
export function buildCodexContinuationPrompt(
  observations: readonly CodexSessionObservation[],
  maxToolResultChars = 20_000
): string {
  const results = observations.map((item, index) => [
    `### 结果 ${index + 1}：${item.tool}${item.isError ? '（失败）' : ''}`,
    `参数：${stableCodexValue(item.arguments)}`,
    item.content.slice(0, maxToolResultChars)
  ].join('\n')).join('\n\n')
  return [
    '【本轮已执行的宿主工具结果】',
    results,
    '',
    '请根据结果继续处理。若仍需读取或暂存，继续输出 toolCalls；若任务已完成，输出空 toolCalls 和最终回复。'
  ].join('\n')
}
