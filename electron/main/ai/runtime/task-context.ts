import type { AiTaskPayload, AppSettings } from '../shared-types'
import { ensureWorkspaceDb } from '../../workspace-store'
import { buildStoryStateContext, formatStoryStateForPrompt } from '../../story-state-store'
import { retrieveHybridContext, formatSemanticSegmentsForPrompt } from '../knowledge-retrieval'
import { buildGameWritingContext } from '../../game-progression-store'

const STORY_STATE_TASKS: ReadonlySet<string> = new Set([
  'story-deep-audit',
  'outline-item',
  'outline-batch',
  'outline-chain',
  'outline-enhance',
  'character-card',
  'character-enhance',
  'worldview-entry',
  'worldview-enhance'
])

/**
 * 在任务执行前补全生成上下文：
 * - chapter-first-draft / chapter-assistant / chapter-analysis / chapter-scene-plan 注入故事状态块与语义片段
 * - 大纲、角色、世界观生成及 story-deep-audit 注入故事状态块
 *
 * 失败时静默跳过，不阻塞主流程。
 */
export async function enrichTaskContextForGeneration(
  task: AiTaskPayload,
  settings: AppSettings
): Promise<void> {
  const projectId = String(task.context.projectId ?? '').trim()
  if (!projectId) {
    return
  }

  if (task.task === 'chapter-humanize' || task.task === 'chapter-repair') {
    try {
      const db = await ensureWorkspaceDb()
      const gameBlock = buildGameWritingContext(db, projectId, String(task.context.chapterId ?? ''))
      if (gameBlock) task.context.gameProgressionBlock = gameBlock
    } catch {
      task.context.gameProgressionBlock = '游戏数值账本当前不可读取，不得新增或改写任何精确数值。'
    }
    return
  }

  if (
    task.task === 'chapter-first-draft' ||
    task.task === 'chapter-assistant' ||
    task.task === 'chapter-analysis' ||
    task.task === 'chapter-scene-plan'
  ) {
    try {
      const hybrid = await retrieveHybridContext(task, settings)
      if (!hybrid) {
        return
      }
      if (hybrid.storyStateBlock) {
        task.context.storyStateBlock = hybrid.storyStateBlock
      } else {
        delete task.context.storyStateBlock
      }
      const semanticBlock = formatSemanticSegmentsForPrompt(hybrid.semanticSegments)
      if (semanticBlock) {
        task.context.semanticSegmentsBlock = semanticBlock
      } else {
        delete task.context.semanticSegmentsBlock
      }
    } catch {
      // 混合检索失败不阻塞生成
    }
    return
  }

  const shouldInjectStoryState = STORY_STATE_TASKS.has(task.task) || (
    task.task === 'catalog-batch' &&
    (task.context.mode === 'character' || task.context.mode === 'worldview')
  )
  if (!shouldInjectStoryState) {
    return
  }

  try {
    const db = await ensureWorkspaceDb()
    const involvedCharIds = extractInvolvedCharacterIds(task.context)
    const storyState = buildStoryStateContext(db, projectId, involvedCharIds)
    const storyStateBlock = formatStoryStateForPrompt(storyState)
    if (storyStateBlock) {
      task.context.storyStateBlock = storyStateBlock
    } else {
      delete task.context.storyStateBlock
    }
  } catch {
    // 状态库查询失败不阻塞生成
  }
}

function extractInvolvedCharacterIds(context: Record<string, unknown>): string[] {
  const ids: string[] = []
  const characters = context.characters
  if (!Array.isArray(characters)) {
    return ids
  }

  for (const char of characters) {
    if (char && typeof char === 'object' && 'id' in char) {
      ids.push(String((char as { id: string }).id))
    }
  }

  return ids
}
