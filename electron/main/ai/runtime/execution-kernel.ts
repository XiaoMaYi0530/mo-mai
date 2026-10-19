import { formatReferenceUsage } from '../../../shared/reference-usage.ts'
import { shouldTryStreamingAgent } from '@shared/ai-provider-catalog'
import type { WorkspacePayload } from '../../workspace-types'
import { retrieveKnowledgeContext } from '../knowledge-retrieval'
import type { AiTaskKnowledgeContext, AiTaskPayload } from '../shared-types'
import { normalizeSettings } from '../settings'
import { buildCreativeMemoryLedger } from '../runtime-v2/context-memory'

export interface PreparedAiExecution {
  settings: ReturnType<typeof normalizeSettings>
  knowledgeContext: AiTaskKnowledgeContext
  useStreamingAgent: boolean
}

function attachProjectDigest(task: AiTaskPayload, snapshot: WorkspacePayload | null): void {
  const projectId = String(task.context.projectId ?? '').trim()
  if (!projectId || !snapshot || task.context.projectDigestBlock) return
  const project = snapshot.projects.find((item) => item.id === projectId)
  const workspace = snapshot.workspaces[projectId]
  if (!project || !workspace) return

  task.context.projectDigestBlock = buildCreativeMemoryLedger({
    project,
    workspace,
    knowledgeDocuments: snapshot.knowledgeDocuments,
    scopeRef: String(task.context.chapterId ?? '')
      ? `chapter:${String(task.context.chapterId)}`
      : undefined
  })
}

/**
 * 所有旧式 AI 任务共用的执行准备接口：归一模型设置、注入同一份项目记忆、
 * 检索知识并决定是否启用 Agent。模型厂商只作为传输 adapter，不参与业务规则。
 */
export function prepareAiExecution(
  task: AiTaskPayload,
  snapshot: WorkspacePayload | null
): PreparedAiExecution {
  attachProjectDigest(task, snapshot)
  const project = snapshot?.projects.find(project => project.id === task.context.projectId)
  task.context.referenceUsageBlock = formatReferenceUsage(project?.referenceUsage, snapshot?.referenceWorks ?? [])
  const settings = normalizeSettings(task.settings)
  return {
    settings,
    knowledgeContext: retrieveKnowledgeContext(
      task,
      snapshot as Parameters<typeof retrieveKnowledgeContext>[1]
    ),
    useStreamingAgent: shouldTryStreamingAgent(
      task.task,
      settings.provider,
      settings.model,
      settings.apiProtocol
    )
  }
}
