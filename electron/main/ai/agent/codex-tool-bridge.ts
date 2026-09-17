import type { AiAgentStreamHandlers, AiRunUsage, AppSettings, ToolCallTrace } from '../shared-types'
import { runCodexCli } from '../codex-cli.ts'
import { stripReasoningMarkup } from '../reasoning.ts'
import type { Tool, ToolContext } from './tools/types'
import { resolveCodexHostToolName } from './codex-tool-name.ts'
import {
  buildCodexRoundInstruction,
  hasReachedCodexPromptBudget,
  isCodexFinalizationRound,
  looksLikeCodexToolProtocol
} from './codex-tool-loop-policy.ts'
import {
  buildCodexContinuationPrompt,
  mergeCodexSessionUsageSnapshot,
  stableCodexValue,
  type CodexSessionObservation
} from './codex-session-state.ts'

type CodexToolCall = {
  name: string
  arguments: Record<string, unknown>
}

type CodexToolEnvelope = {
  toolCalls: CodexToolCall[]
  finalText: string
}

export type RunCodexToolAgentParams = {
  settings: AppSettings
  systemPrompt: string
  userPrompt: string
  tools: Tool[]
  ctx: ToolContext
  handlers: AiAgentStreamHandlers
  maxSteps: number
  disableTools?: boolean
  requiredToolNames?: string[]
}

export type CodexToolAgentResult = {
  finalText: string
  toolCalls: ToolCallTrace[]
  iterations: number
  usage?: AiRunUsage
}

const MAX_TOOL_CALLS_PER_STEP = 12
const MAX_TOOL_RESULT_CHARS = 20_000
const MAX_TOOL_DESCRIPTION_CHARS = 240
const MAX_SCHEMA_DESCRIPTION_CHARS = 120

const STAGED_SUCCESS_CLAIM_PATTERNS = [
  /(?:已|已经|成功)(?:重新)?(?:生成|创建)[^。！？\n]{0,40}(?:待审阅|暂存(?:变更)?)/,
  /(?:待审阅|暂存(?:变更)?)[^。！？\n]{0,40}(?:已|已经|成功)(?:生成|创建|完成)/,
  /已(?:经)?暂存(?:章节|人物|世界观|大纲|组织|关系|设定|项目|知识|灵感|分卷)?(?:修改|变更|新增|删除)/
]

function claimsSuccessfulStagedChange(text: string): boolean {
  return STAGED_SUCCESS_CLAIM_PATTERNS.some((pattern) => pattern.test(String(text ?? '')))
}

function extractChangeIds(text: string): string[] {
  const ids: string[] = []
  const pattern = /(?:change[_\s-]?id|暂存(?:变更)?编号)\s*[：:=]\s*([A-Za-z0-9_-]{6,})/gi
  for (const match of String(text ?? '').matchAll(pattern)) {
    if (match[1]) ids.push(match[1])
  }
  return [...new Set(ids)]
}

/**
 * 暂存成功属于宿主事实，不能由模型根据历史对话自行推断。
 * 返回 null 表示回复与本轮工具记录一致，否则返回供模型修正的原因。
 */
export function validateStagedChangeClaim(
  finalText: string,
  observations: CodexSessionObservation[]
): string | null {
  if (!claimsSuccessfulStagedChange(finalText)) return null

  const successfulStages = observations.filter((item) => !item.isError && item.tool.startsWith('stage_'))
  if (successfulStages.length === 0) {
    return '本轮没有成功执行任何 stage_ 宿主工具，因此不能声称已生成待审阅暂存变更，也不能复用历史对话中的 change_id。'
  }

  const claimedIds = extractChangeIds(finalText)
  if (claimedIds.length === 0) return null
  const currentIds = new Set(successfulStages.flatMap((item) => extractChangeIds(item.content)))
  const staleIds = claimedIds.filter((id) => !currentIds.has(id))
  return staleIds.length > 0
    ? `回复中的 change_id（${staleIds.join('、')}）不是本轮 stage_ 工具返回的编号，禁止引用为本轮新暂存。`
    : null
}

function stagedClaimBlockedText(): string {
  return '本轮未生成新的暂存变更；系统已阻止复用历史暂存编号。请重试本次修改请求。'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 从混合文本中提取彼此相邻的顶层 JSON 对象，正确跳过字符串里的花括号。 */
function extractTopLevelJsonObjects(text: string): string[] {
  const objects: string[] = []
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"' && depth > 0) {
      inString = true
    } else if (char === '{') {
      if (depth === 0) start = index
      depth += 1
    } else if (char === '}' && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, index + 1))
        start = -1
      }
    }
  }
  return objects
}

function jsonCandidates(text: string): string[] {
  const trimmed = stripReasoningMarkup(text).trim()
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  if (fenced) candidates.push(fenced)
  candidates.push(...extractTopLevelJsonObjects(trimmed))
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1))
  }
  return [...new Set(candidates)]
}

/** 解析 Codex 返回的宿主工具协议；普通聊天文本返回 null，由调用方直接展示。 */
export function parseCodexToolEnvelope(text: string): CodexToolEnvelope | null {
  let latest: CodexToolEnvelope | null = null
  for (const candidate of jsonCandidates(text)) {
    let value: unknown
    try {
      value = JSON.parse(candidate)
    } catch {
      continue
    }
    if (!isRecord(value) || !Array.isArray(value.toolCalls) || typeof value.finalText !== 'string') {
      continue
    }
    const toolCalls: CodexToolCall[] = []
    let valid = true
    for (const rawCall of value.toolCalls.slice(0, MAX_TOOL_CALLS_PER_STEP)) {
      if (!isRecord(rawCall) || typeof rawCall.name !== 'string' || !isRecord(rawCall.arguments)) {
        valid = false
        break
      }
      const name = rawCall.name.trim()
      if (!name) {
        valid = false
        break
      }
      toolCalls.push({ name, arguments: rawCall.arguments })
    }
    if (valid) latest = { toolCalls, finalText: value.finalText.trim() }
  }
  return latest
}

function compactToolSchema(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((item) => compactToolSchema(item))
  if (!isRecord(value)) {
    if (typeof value === 'string' && key === 'description') {
      return value.slice(0, MAX_SCHEMA_DESCRIPTION_CHARS)
    }
    return value
  }
  const output: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value)) {
    if (childKey === 'title' || childKey === '$comment' || childKey === 'examples' || childKey === 'default') continue
    output[childKey] = compactToolSchema(childValue, childKey)
  }
  return output
}

export function buildToolProtocolPrompt(tools: Tool[]): string {
  const catalog = tools.map((tool) => ({
    name: tool.definition.name,
    description: tool.definition.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS),
    inputSchema: compactToolSchema(tool.definition.inputSchema)
  }))
  return [
    '【墨脉宿主工具协议】',
    '你可以通过下面的 JSON 协议请求墨脉执行进程内工具。这里的工具由应用宿主执行，不是 Codex CLI 的 shell 工具；即使本地 shell 工具被禁用，也必须按任务需要调用这些宿主工具。',
    '每次回复必须只输出一个 JSON 对象，不能使用 Markdown 代码块，也不能在 JSON 前后添加说明：',
    '{"toolCalls":[{"name":"工具名","arguments":{"参数":"值"}}],"finalText":""}',
    '规则：',
    '1. 需要读取资料或生成暂存变更时，把调用写入 toolCalls，并把 finalText 留空。宿主执行后会把结果发给你继续处理。',
    '2. 已经得到足够结果时，toolCalls 传空数组，把面向用户的中文回复写入 finalText。',
    '3. 修改项目数据必须调用对应的 stage_* 工具进入暂存区，绝不能只在 finalText 里描述拟修改内容，也不要声称工具不可用。',
    '4. 只能使用目录里列出的工具和参数；不得虚构工具名。工具名是普通 JSON 字符串，下划线不要写成 Markdown 转义。',
    '5. 只有本轮成功执行 stage_* 工具后，才能声称已生成暂存变更；finalText 中的 change_id 必须来自本轮工具结果，禁止复用历史编号。',
    '',
    '【可用宿主工具目录】',
    JSON.stringify(catalog)
  ].join('\n')
}

function formatToolError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function runTextOnly(params: RunCodexToolAgentParams): Promise<CodexToolAgentResult> {
  params.handlers.onAgentStatus('正在通过 Codex CLI 思考...', 1, 1)
  const result = await runCodexCli(
    params.settings,
    { system: params.systemPrompt, user: params.userPrompt },
    { signal: params.ctx.signal, handlers: params.handlers }
  )
  return {
    finalText: stripReasoningMarkup(result.text),
    toolCalls: [],
    iterations: 1,
    usage: result.usage
  }
}

/**
 * Codex CLI 本身不能直接持有 Electron 进程内函数，因此用受限 JSON 协议桥接：
 * Codex 只选择工具和参数，实际读取与暂存仍由墨脉宿主执行。
 */
export async function runCodexToolAgent(
  params: RunCodexToolAgentParams
): Promise<CodexToolAgentResult> {
  if (params.disableTools || params.tools.length === 0) return await runTextOnly(params)

  const toolsByName = new Map(params.tools.map((tool) => [tool.definition.name, tool]))
  const availableToolNames = new Set(toolsByName.keys())
  const traces: ToolCallTrace[] = []
  const observations: CodexSessionObservation[] = []
  const seenResults = new Map<string, { content: string; isError: boolean }>()
  let usage: AiRunUsage | undefined
  let codexSessionId: string | undefined
  let deliveredObservationCount = 0
  const protocolPrompt = buildToolProtocolPrompt(params.tools)

  for (let step = 1; step <= params.maxSteps; step += 1) {
    params.ctx.signal.throwIfAborted()
    const requiredToolsSatisfied = (params.requiredToolNames ?? []).every((name) => (
      traces.some((trace) => trace.tool === name && trace.status === 'ok')
    ))
    // 必须真实落库的任务在首次保存前不能被软预算直接赶进“禁止工具”的收尾轮。
    const tokenBudgetReached = hasReachedCodexPromptBudget(usage?.promptTokens) && requiredToolsSatisfied
    const forceFinalize = isCodexFinalizationRound(step, params.maxSteps) || tokenBudgetReached
    const roundInstruction = buildCodexRoundInstruction(
      step,
      params.maxSteps,
      tokenBudgetReached ? 'token-budget' : 'step-limit'
    )
    params.handlers.onAgentStatus(
      step === 1 ? '正在通过 Codex CLI 思考...' : `Codex CLI 第 ${step} 轮处理中...`,
      step,
      params.maxSteps
    )
    const followupObservations = codexSessionId
      ? observations.slice(deliveredObservationCount)
      : observations
    const prompt = [
      step === 1
        ? params.userPrompt
        : buildCodexContinuationPrompt(followupObservations, MAX_TOOL_RESULT_CHARS),
      '',
      roundInstruction
    ].join('\n')
    if (codexSessionId) deliveredObservationCount = observations.length
    const result = await runCodexCli(
      params.settings,
      {
        system: [params.systemPrompt, protocolPrompt].join('\n\n'),
        user: prompt
      },
      {
        signal: params.ctx.signal,
        resumeSessionId: codexSessionId,
        // 协议 JSON 不能作为聊天正文显示；推理过程仍照常转发。
        handlers: {
          onTextDelta: () => {},
          onReasoningDelta: params.handlers.onReasoningDelta
        }
      }
    )
    codexSessionId = result.sessionId ?? codexSessionId
    usage = mergeCodexSessionUsageSnapshot(usage, result.usage)
    const envelope = parseCodexToolEnvelope(result.text)

    // 向下兼容普通文本回复。协议解析失败时仍可聊天，但不会伪造工具执行结果。
    if (!envelope) {
      const finalText = stripReasoningMarkup(result.text).trim()
      if (looksLikeCodexToolProtocol(finalText)) {
        const stagedCount = traces.filter((trace) => trace.status === 'ok' && trace.tool.startsWith('stage_')).length
        if (forceFinalize) {
          const safeFinalText = stagedCount > 0
            ? `已生成 ${stagedCount} 条待审阅变更，请在右侧暂存区逐条确认。`
            : 'Codex CLI 返回的工具协议格式不完整，已阻止原始 JSON 显示和执行。请重试本次请求。'
          params.handlers.onTextDelta(safeFinalText)
          return { finalText: safeFinalText, toolCalls: traces, iterations: step, usage }
        }

        params.handlers.onAgentStatus('工具协议格式不完整，正在自动修复...', step, params.maxSteps)
        observations.push({
          tool: 'protocol_validation',
          arguments: {},
          content: [
            '上一轮返回的工具协议 JSON 格式错误，未执行也未向用户展示。',
            '请修正 JSON 语法后完整重新输出一个协议对象，不要添加 Markdown 或解释文字。',
            `无效响应片段：${finalText.slice(0, 4000)}`
          ].join('\n'),
          isError: true
        })
        continue
      }
      if (!requiredToolsSatisfied) {
        if (forceFinalize) {
          return { finalText, toolCalls: traces, iterations: step, usage }
        }
        observations.push({
          tool: 'required_tool_validation',
          arguments: {},
          content: `任务尚未成功调用必需工具：${(params.requiredToolNames ?? []).join('、')}。请按宿主工具协议立即调用，不要返回普通正文。`,
          isError: true
        })
        params.handlers.onAgentStatus('尚未保存任务结果，正在要求模型执行落库...', step, params.maxSteps)
        continue
      }
      const stagedClaimError = validateStagedChangeClaim(finalText, observations)
      if (stagedClaimError) {
        if (forceFinalize) {
          const safeFinalText = stagedClaimBlockedText()
          params.handlers.onTextDelta(safeFinalText)
          return { finalText: safeFinalText, toolCalls: traces, iterations: step, usage }
        }
        params.handlers.onAgentStatus('检测到暂存状态与本轮工具记录不一致，正在自动修正...', step, params.maxSteps)
        observations.push({
          tool: 'staged_change_validation',
          arguments: {},
          content: `${stagedClaimError}\n如果用户要求修改，请立即调用合适的 stage_* 工具；否则请如实说明本轮没有生成暂存。`,
          isError: true
        })
        continue
      }
      if (finalText) params.handlers.onTextDelta(finalText)
      return { finalText, toolCalls: traces, iterations: step, usage }
    }

    if (envelope.toolCalls.length === 0) {
      if (!envelope.finalText) {
        throw new Error('Codex CLI 返回了空的工具协议响应。')
      }
      if (!requiredToolsSatisfied) {
        if (forceFinalize) {
          return { finalText: envelope.finalText, toolCalls: traces, iterations: step, usage }
        }
        observations.push({
          tool: 'required_tool_validation',
          arguments: {},
          content: `任务尚未成功调用必需工具：${(params.requiredToolNames ?? []).join('、')}。请立即调用，不要只在 finalText 中描述结果。`,
          isError: true
        })
        params.handlers.onAgentStatus('尚未保存任务结果，正在要求模型执行落库...', step, params.maxSteps)
        continue
      }
      const stagedClaimError = validateStagedChangeClaim(envelope.finalText, observations)
      if (stagedClaimError) {
        if (forceFinalize) {
          const safeFinalText = stagedClaimBlockedText()
          params.handlers.onTextDelta(safeFinalText)
          return { finalText: safeFinalText, toolCalls: traces, iterations: step, usage }
        }
        params.handlers.onAgentStatus('检测到暂存状态与本轮工具记录不一致，正在自动修正...', step, params.maxSteps)
        observations.push({
          tool: 'staged_change_validation',
          arguments: {},
          content: `${stagedClaimError}\n如果用户要求修改，请立即调用合适的 stage_* 工具；否则请如实说明本轮没有生成暂存。`,
          isError: true
        })
        continue
      }
      params.handlers.onTextDelta(envelope.finalText)
      return {
        finalText: envelope.finalText,
        toolCalls: traces,
        iterations: step,
        usage
      }
    }

    // 最后一轮是专用收尾轮。即使模型忽略协议继续请求工具，也不再执行，
    // 避免“最后一轮又读一页，随后直接报错”。
    if (forceFinalize) {
      const stagedCount = traces.filter((trace) => trace.status === 'ok' && trace.tool.startsWith('stage_')).length
      let finalText = envelope.finalText
        || (stagedCount > 0
          ? `已生成 ${stagedCount} 条待审阅变更，请在右侧暂存区逐条确认。`
          : '已读取相关资料，但本轮尚未完成最终处理。请点击“继续”，我会基于已有结果继续，不重复遍历资料。')
      if (validateStagedChangeClaim(finalText, observations)) finalText = stagedClaimBlockedText()
      params.handlers.onTextDelta(finalText)
      return {
        finalText,
        toolCalls: traces,
        iterations: step,
        usage
      }
    }

    let stepHasError = false
    for (const [index, call] of envelope.toolCalls.entries()) {
      const resolvedToolName = resolveCodexHostToolName(call.name, availableToolNames)
      const reportedToolName = resolvedToolName ?? call.name
      const toolUseId = `codex-${step}-${index + 1}`
      const startedAt = Date.now()
      params.handlers.onToolUseStart(toolUseId, reportedToolName, call.arguments)

      const fingerprint = `${reportedToolName}:${stableCodexValue(call.arguments)}`
      const cached = seenResults.get(fingerprint)
      let content = ''
      let isError = false
      if (cached) {
        content = `（相同工具和参数已执行过，未重复写入。）\n${cached.content}`
        isError = cached.isError
      } else {
        const tool = resolvedToolName ? toolsByName.get(resolvedToolName) : undefined
        if (!tool) {
          content = `未知宿主工具：${call.name}。请只使用可用工具目录中的名称。`
          isError = true
        } else {
          try {
            const toolResult = await tool.handler(call.arguments, params.ctx)
            content = toolResult.content
            isError = Boolean(toolResult.isError)
          } catch (error) {
            content = formatToolError(error)
            isError = true
          }
        }
        seenResults.set(fingerprint, { content, isError })
      }

      const durationMs = Date.now() - startedAt
      params.handlers.onToolResult(
        toolUseId,
        reportedToolName,
        content.slice(0, 800),
        isError,
        durationMs
      )
      traces.push({
        tool: reportedToolName,
        args: call.arguments,
        durationMs,
        status: isError ? 'error' : 'ok',
        ...(isError ? { error: content.slice(0, 240) } : {})
      })
      observations.push({ tool: reportedToolName, arguments: call.arguments, content, isError })
      stepHasError ||= isError
    }

    // 兼容少数模型在同一协议响应中同时给出成功工具调用和最终说明。
    if (envelope.finalText && !stepHasError) {
      const stagedClaimError = validateStagedChangeClaim(envelope.finalText, observations)
      if (stagedClaimError) {
        params.handlers.onAgentStatus('检测到暂存编号与本轮工具结果不一致，正在自动修正...', step, params.maxSteps)
        observations.push({
          tool: 'staged_change_validation',
          arguments: {},
          content: `${stagedClaimError}\n请只引用本轮 stage_* 工具结果中的 change_id，并重新输出最终回复。`,
          isError: true
        })
        continue
      }
      params.handlers.onTextDelta(envelope.finalText)
      return {
        finalText: envelope.finalText,
        toolCalls: traces,
        iterations: step,
        usage
      }
    }
  }

  const stagedCount = traces.filter((trace) => trace.status === 'ok' && trace.tool.startsWith('stage_')).length
  if (stagedCount > 0) {
    const finalText = `已生成 ${stagedCount} 条待审阅变更，请在右侧暂存区逐条确认。`
    params.handlers.onTextDelta(finalText)
    return {
      finalText,
      toolCalls: traces,
      iterations: params.maxSteps,
      usage
    }
  }
  throw new Error(`Codex CLI 在 ${params.maxSteps} 轮内未能完成宿主工具任务。`)
}
