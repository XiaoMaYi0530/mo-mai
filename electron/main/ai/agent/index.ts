import type {
  AiAgentStreamHandlers,
  AiKnowledgeDocumentDraft,
  AiRunUsage,
  AiTaskKnowledgeContext,
  AiTaskPayload,
  AiTaskResponse,
  ToolCallTrace
} from '../shared-types'
import { normalizeSettings, validateSettings, resolveMaxTokens, shouldOmitMaxTokens } from '../settings'
import { getTaskHandler } from '../tasks'
import { getAllSkills, getSkillById, resolveTaskSkills } from '../skills'
import { isSkillEnabledForTask } from '../skills/task-selection'
import { addAiRunUsage, aiGenerateTextWithUsage } from '../generate'
import { buildPromptInput } from '../runtime/context-builder'
import { enrichTaskContextForGeneration } from '../runtime/task-context'
import { buildRunMeta, buildResponsePreview } from '../runtime/run-meta'
import { logPrompt, logResponse, logSelection, logError } from '../runtime/logging'
import { buildRepairPrompt } from '../prompts/repair'
import { runAgent } from './run-agent'
import { createSkillTools } from './tools/skill-tools'
import { createKnowledgeTools } from './tools/knowledge-tools'
import { createChapterTools } from './tools/chapter-tools'
import { createProjectDataTools } from './tools/project-data-tools'
import { buildAgentBehaviorRules, buildSkillIndex } from './system-prompt'
import { formatAiErrorMessage } from '../error-message'
import { buildSkillContentExcerpt } from '../skills/content-slice'
import { annotateReferenceDeepAnalysisDocument } from '@shared/reference-deep-analysis'

/**
 * 非流式 agent 各任务的工具循环步数上限。
 * 默认 8 步对深度任务太紧：reference-deep-analyze 要多轮读参考文件 + 项目数据，
 * outline-batch 需读大纲/角色再成稿，撞上限会被静默掐断导致结果残缺。
 */
function resolveAgentMaxSteps(taskName: AiTaskPayload['task']): number {
  switch (taskName) {
    case 'reference-deep-analyze':
      return 16
    case 'global-assistant':
      return 12
    case 'outline-batch':
      return 10
    case 'style-fingerprint-extract':
    default:
      return 8
  }
}

const NOOP_AGENT_HANDLERS: AiAgentStreamHandlers = {
  onTextDelta: () => {},
  onToolUseStart: () => {},
  onToolResult: () => {},
  onAgentStatus: () => {},
  onEditApplied: () => {},
  onEditProposed: () => {}
}

export async function runAgentTask(
  task: AiTaskPayload,
  knowledgeContext?: AiTaskKnowledgeContext
): Promise<AiTaskResponse> {
  const settings = normalizeSettings(task.settings)
  validateSettings(settings)
  const startedAt = new Date().toISOString()
  const chapterId = String(task.context.chapterId ?? '').trim() || undefined

  const handler = getTaskHandler(task.task)
  const { projectId, skills: resolvedSkills } = await resolveTaskSkills(task)
  const usesDirectFingerprintMethod = task.task === 'style-fingerprint-extract' || task.task === 'reference-deep-analyze'
  const candidateSkills = usesDirectFingerprintMethod
    ? resolvedSkills.filter((skill) => skill.id === 'style-fingerprint')
    : resolvedSkills
  const usedSkillIds = candidateSkills.map((skill) => skill.id)
  logSelection(task.task, candidateSkills, knowledgeContext?.usedKnowledge ?? [])
  await enrichTaskContextForGeneration(task, settings)

  const input = buildPromptInput(task, candidateSkills, knowledgeContext)
  const prompt = handler.buildPrompt(input)
  const baseMaxTokens = handler.resolveMaxTokens?.(input) ?? resolveMaxTokens(task) ?? 4096
  // 与流式 agent 路径保持一致：抬高输出预算下限，避免推理模型把预算耗在推理 token 上导致空输出。
  const maxTokens = shouldOmitMaxTokens(task.task) ? undefined : Math.max(baseMaxTokens, 16000)

  const candidateSkillDefs = candidateSkills
    .map((sel) => getSkillById(sel.id, projectId || undefined))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const requiredSkillDefs = candidateSkillDefs.filter((s) => s.manifest.required)
  const directlyInjectedSkillDefs = usesDirectFingerprintMethod
    ? candidateSkillDefs.filter((skill) => skill.id === 'style-fingerprint')
    : requiredSkillDefs
  const directlyInjectedSkillIds = new Set(directlyInjectedSkillDefs.map((skill) => skill.id))
  const optionalSkillDefs = candidateSkillDefs.filter((skill) => !directlyInjectedSkillIds.has(skill.id))

  const requiredSkillBlock = directlyInjectedSkillDefs.length && !usesDirectFingerprintMethod
    ? `\n\n## 已直接注入的 SKILLS（无需调用 skill_load 或 skill_read_reference）\n\n${directlyInjectedSkillDefs.map((s) => {
        const body = buildSkillContentExcerpt(s, task, usesDirectFingerprintMethod ? 5200 : 2400)
        return `### ${s.name}\n${body}`
      }).join('\n\n')}`
    : ''

  const globalAssistantRules = task.task === 'global-assistant' || task.task === 'global-assistant-proposal'
    ? [
        '',
        '## Global Assistant Agent Rules',
        '',
        '- Decide which project modules to inspect before answering. Do not rely only on short summaries when the request depends on concrete project facts.',
        '- Prefer `read_project_data` without `entity_type` to get a quick index, then read only the modules that matter.',
        '- Use narrow reads whenever possible: `summary_only=true` for reconnaissance, `limit` to avoid over-reading, `entity_id` for exact entities, and `doc_key` for creative memory.',
        '- When the user asks what skills exist, what skills are enabled, or asks to summarize every skill, you must call `skill_list` first and answer from its result. The skill index above is only the current task-matched subset, not the complete registry.',
        '- Do not rely on the static skill list alone. When the task may benefit from project skills, you must decide which skills are relevant and explicitly call `skill_load` yourself before concluding.',
        '- Use `search_project` first when the user mentions a specific concept, role, event, clue, workflow artifact, or rule and you are not sure where it lives.',
        '- Treat `project_constraints` as hard boundaries and `workflow_documents` as creative memory. If they may affect the answer, inspect them before concluding.',
        '- Prefer targeted reads over loading every module. Read just enough context to answer well.',
        '- After using tools, produce a direct answer for the user instead of stopping at notes or partial findings.'
      ].join('\n')
    : ''

  const systemPrompt = `${prompt.system}${requiredSkillBlock}\n${buildSkillIndex(optionalSkillDefs)}\n${buildAgentBehaviorRules()}${globalAssistantRules}`

  const skillTools = createSkillTools({
    resolveSkill: (id) => getSkillById(id, projectId || undefined),
    listSkills: () => getAllSkills(projectId || undefined),
    resolveSkillEnabled: (skill) => isSkillEnabledForTask(task, skill.id, projectId),
    resolveSkillLoadContent: (skill) => buildSkillContentExcerpt(skill, task),
    allowScriptExecution: (skill) => skill.scope === 'builtin'
  })

  const producedKnowledgeDocuments: AiKnowledgeDocumentDraft[] = []
  const referenceTitle = String(task.context.referenceTitle ?? task.context.sourceTitle ?? '').trim()
  const knowledgeTools = createKnowledgeTools({
    collectDocument: (doc) => {
      producedKnowledgeDocuments.push(
        task.task === 'reference-deep-analyze'
          ? annotateReferenceDeepAnalysisDocument(doc, String(task.context.referenceWorkId ?? '').trim())
          : doc
      )
    },
    defaultSourceLabel: referenceTitle || 'agent'
  })

  const chapterTools = createChapterTools({
    currentChapterId: chapterId || '',
    originalUserPrompt: String(task.context.originalUserPrompt ?? task.context.userPrompt ?? ''),
    blockVagueChapterEdit: task.task === 'global-assistant',
    onEditApplied: NOOP_AGENT_HANDLERS.onEditApplied
  })

  const projectDataTools = createProjectDataTools()

  // 拆书任务的原文和方法论均已直接注入，只开放落库工具，避免模型先后加载
  // Skill/项目资料，在真正保存前耗尽 Codex CLI 的输入预算。
  const tools = task.task === 'style-fingerprint-extract' || task.task === 'reference-deep-analyze'
    ? knowledgeTools
    : [...skillTools, ...knowledgeTools, ...chapterTools, ...projectDataTools]
  const controller = new AbortController()

  logPrompt('AGENT_REQUEST', settings, { system: systemPrompt, user: prompt.user }, task.task, usedSkillIds)
  const requestStartedAt = Date.now()
  let totalUsage: AiRunUsage | undefined
  let loopResult: Awaited<ReturnType<typeof runAgent>> | undefined
  let lastAgentText = ''
  const observedToolCalls: ToolCallTrace[] = []
  const observedToolCallIndex = new Map<string, number>()
  const agentHandlers: AiAgentStreamHandlers = {
    ...NOOP_AGENT_HANDLERS,
    onToolUseStart: (toolUseId, tool, args) => {
      observedToolCallIndex.set(toolUseId, observedToolCalls.length)
      observedToolCalls.push({ tool, args, durationMs: 0, status: 'ok' })
    },
    onToolResult: (toolUseId, _tool, content, isError, durationMs) => {
      const index = observedToolCallIndex.get(toolUseId)
      if (index === undefined) return
      observedToolCalls[index] = {
        ...observedToolCalls[index],
        durationMs,
        status: isError ? 'error' : 'ok',
        ...(isError ? { error: content.slice(0, 240) } : {})
      }
    }
  }

  try {
    loopResult = await runAgent({
      settings,
      systemPrompt,
      userPrompt: prompt.user,
      tools,
      ctx: { signal: controller.signal, projectId },
      handlers: agentHandlers,
      maxTokens,
      maxSteps: resolveAgentMaxSteps(task.task),
      requiredToolNames: task.task === 'reference-deep-analyze' || task.task === 'style-fingerprint-extract'
        ? ['knowledge_save_document']
        : undefined
    })
    totalUsage = addAiRunUsage(totalUsage, loopResult.usage)
    lastAgentText = loopResult.finalText
    logResponse('AGENT_REQUEST', settings, task.task, loopResult.finalText, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })

    if (
      (task.task === 'reference-deep-analyze' || task.task === 'style-fingerprint-extract')
      && producedKnowledgeDocuments.length === 0
    ) {
      throw new Error(
        task.task === 'style-fingerprint-extract'
          ? '风格指纹分析已结束，但没有生成可保存的指纹文档。本次不再误报成功，请重试或切换模型。'
          : '深度拆书已结束，但没有生成任何知识文档。本次不再误报成功，请重试或切换模型。'
      )
    }

    let rawText = loopResult.finalText
    let result: ReturnType<typeof handler.normalize>
    let normalizeFailed = false
    try {
      result = handler.normalize(rawText, task.context)
    } catch {
      result = {} as ReturnType<typeof handler.normalize>
      normalizeFailed = true
    }
    let repairTriggered = false

    if (handler.outputType === 'json' && (normalizeFailed || !handler.validate(result))) {
      const MAX_REPAIR_ATTEMPTS = 2
      for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
        const validationErrors = (!normalizeFailed && handler.describeValidationErrors)
          ? handler.describeValidationErrors(result)
          : ['JSON 解析失败或结构不完整']
        const repairPromptPair = buildRepairPrompt(prompt.system, prompt.user, rawText, validationErrors)
        logPrompt(`AGENT_REPAIR_${attempt}`, settings, repairPromptPair, task.task, usedSkillIds)
        const repairStartedAt = Date.now()
        const repairResult = await aiGenerateTextWithUsage(settings, repairPromptPair, maxTokens)
        totalUsage = addAiRunUsage(totalUsage, repairResult.usage)
        rawText = repairResult.text
        logResponse(`AGENT_REPAIR_${attempt}`, settings, task.task, rawText, Date.now() - repairStartedAt, { usedSkills: usedSkillIds })
        normalizeFailed = false
        try {
          result = handler.normalize(rawText, task.context)
        } catch {
          result = {} as ReturnType<typeof handler.normalize>
          normalizeFailed = true
        }
        repairTriggered = true

        if (!normalizeFailed && handler.validate(result)) {
          break
        }

        if (attempt === MAX_REPAIR_ATTEMPTS) {
          throw new Error('AI 返回的结构化结果经过 2 次修复仍不完整，请稍后重试或调整提示词。')
        }
      }
    }

    const finishedAt = new Date().toISOString()
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'success',
      startedAt, finishedAt,
      totalUsage,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      repairTriggered, buildResponsePreview(result), ''
    )
    meta.toolCalls = loopResult.toolCalls
    meta.agentIterations = loopResult.iterations
    if (producedKnowledgeDocuments.length > 0) {
      meta.producedKnowledgeDocuments = producedKnowledgeDocuments
    }

    return { result, meta }
  } catch (error) {
    const finishedAt = new Date().toISOString()
    const baseMessage = formatAiErrorMessage(error, 'AI 调用失败')
    const message = task.task === 'reference-deep-analyze' && producedKnowledgeDocuments.length > 0
      ? `本轮已保存 ${producedKnowledgeDocuments.length} 个拆书维度，后续步骤未完成：${baseMessage}。可点击“继续深度拆书”补齐剩余维度。`
      : baseMessage
    logError('AGENT_REQUEST', settings, task.task, error, Date.now() - requestStartedAt, { usedSkills: usedSkillIds })
    const meta = buildRunMeta(
      task.task, projectId, chapterId, settings, 'error',
      startedAt, finishedAt,
      totalUsage,
      knowledgeContext?.usedKnowledge ?? [], usedSkillIds,
      false, lastAgentText, message
    )
    meta.toolCalls = loopResult?.toolCalls ?? observedToolCalls
    if (loopResult?.iterations) meta.agentIterations = loopResult.iterations
    if (producedKnowledgeDocuments.length > 0) {
      meta.producedKnowledgeDocuments = producedKnowledgeDocuments
    }
    throw Object.assign(new Error(message), { aiRunMeta: meta })
  }
}
