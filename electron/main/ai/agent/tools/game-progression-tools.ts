import { formatCombatRulesForWriting } from '../../../../shared/game-combat.ts'
import { ensureWorkspaceDb } from '../../../workspace-store'
import { applyGameCommand, chapterIndexForGame, readGameProject } from '../../../game-progression-store'
import { formatGameSnapshotForWriting, gameSnapshot, previewGameOperation, searchGameAssets, type GameOperation } from '../../../../shared/game-progression'
import type { Tool } from './types'

function error(message: string): { content: string; isError: true } {
  return { content: message, isError: true }
}

function operationFromInput(input: Record<string, unknown>): GameOperation {
  const kind = String(input.operation ?? '')
  const assetId = String(input.asset_id ?? '').trim()
  const quantity = Number(input.quantity ?? 1)
  switch (kind) {
    case 'level-up': return { kind, levels: Number(input.levels ?? 1) }
    case 'allocate': return { kind, statId: String(input.stat_id ?? '').trim(), points: Number(input.points ?? 1) }
    case 'acquire': return { kind, assetId, quantity }
    case 'equip': return { kind, assetId, ...(input.slot_id ? { slotId: String(input.slot_id).trim() } : {}) }
    case 'unequip': return { kind, slotId: String(input.slot_id ?? '').trim() }
    case 'activate-title': return { kind, assetId }
    case 'deactivate-title': return { kind }
    case 'activate-special': return { kind, assetId }
    case 'deactivate-special': return { kind, assetId }
    case 'learn-skill': return { kind, assetId }
    case 'forget-skill': return { kind, assetId }
    case 'use-skill': return { kind, assetId }
    case 'take-damage': return { kind, amount: Number(input.amount ?? 1) }
    case 'restore-resource': return { kind, resourceId: input.resource_id === 'health' ? 'health' : 'mana', amount: Number(input.amount ?? 1) }
    case 'rest': return { kind }
    case 'consume': return { kind, assetId, quantity }
    default: throw new Error('不支持的数值操作。')
  }
}

function changeKey(input: Record<string, unknown>, characterId: string, operation: GameOperation): string {
  const supplied = String(input.change_key ?? '').trim()
  return (supplied || `${characterId}:${JSON.stringify(operation)}`).slice(0, 240)
}

export function createGameProgressionTools(chapterId: string, aiRunId = ''): Tool[] {
  if (!chapterId) return []
  return [{
    definition: {
      name: 'read_game_state',
      description: 'Read confirmed game catalogue and a character’s computed chapter state. Never invent missing stats or IDs. Use before a level-up, equipment swap, skill, title or inventory change.',
      inputSchema: { type: 'object', properties: {
        character_id: { type: 'string', description: 'Character card ID. Omit to list characters.' },
        query: { type: 'string', description: 'Optional catalogue name, alias or tag search.' }
      } }
    },
    handler: async (input, ctx) => {
      try {
        const db = await ensureWorkspaceDb()
        const { data } = readGameProject(db, ctx.projectId)
        if (!data.enabled) return error('本作品未启用游戏数值档案。')
        const characterId = String(input.character_id ?? '').trim()
        const query = String(input.query ?? '').trim()
        const characters = db.prepare('SELECT id, name FROM characters WHERE project_id = ?').all(ctx.projectId) as Array<{ id: string; name: string }>
        const catalog = query ? searchGameAssets(data, query, undefined, 20) : []
        const lines = [`人物：${characters.filter((entry) => data.characters.some((seed) => seed.characterId === entry.id)).map((entry) => `${entry.name}[${entry.id}]`).join('、') || '无'}`]
        lines.push(formatCombatRulesForWriting(data, chapterIndexForGame(db, ctx.projectId, chapterId)))
        if (characterId) {
          const chapterIndex = chapterIndexForGame(db, ctx.projectId, chapterId)
          lines.push(formatGameSnapshotForWriting(data, gameSnapshot(data, characterId, chapterIndex, chapterId)))
        }
        if (query) lines.push(`目录搜索“${query}”：${catalog.map((asset) => `${asset.name}[${asset.id}] ${asset.kind} 槽位=${asset.slotId || '无'} ${asset.kind === 'skill' ? JSON.stringify(asset.skill) : JSON.stringify(asset.bonuses)}`).join('；') || '无已确认匹配条目'}`)
        return { content: lines.join('\n') }
      } catch (cause) { return error(cause instanceof Error ? cause.message : String(cause)) }
    }
  }, {
    definition: {
      name: 'stage_game_change',
      description: 'Stage one chapter-local deterministic game change. Call only when the chapter plot or author explicitly requires this change. Returns exact before/after stats. It remains pending until the author confirms the chapter; do not claim it is committed. The item must already exist in the confirmed catalogue. Reuse the same change_key when retrying one story beat.',
      inputSchema: { type: 'object', required: ['character_id', 'operation'], properties: {
        character_id: { type: 'string' },
        operation: { type: 'string', enum: ['level-up', 'allocate', 'acquire', 'equip', 'unequip', 'activate-title', 'deactivate-title', 'activate-special', 'deactivate-special', 'learn-skill', 'forget-skill', 'use-skill', 'take-damage', 'restore-resource', 'rest', 'consume'] },
        asset_id: { type: 'string' }, stat_id: { type: 'string' }, slot_id: { type: 'string', description: '卸下时必填；装备通用戒指或饰品时填写目标格 ring1/ring2 或 accessory1/accessory2。' },
        levels: { type: 'integer' }, points: { type: 'integer' }, quantity: { type: 'integer' }, amount: { type: 'integer' },
        resource_id: { type: 'string', enum: ['health', 'mana'] },
        change_key: { type: 'string', description: 'Stable short ID for this story beat, e.g. boss-defeat-level-up.' },
        narrative_note: { type: 'string', description: 'Short story trigger, e.g. 击败岩甲熊后.' }
      } }
    },
    handler: async (input, ctx) => {
      try {
        if (ctx.signal.aborted) throw new Error('本次生成已取消。')
        const characterId = String(input.character_id ?? '').trim()
        const operation = operationFromInput(input)
        const db = await ensureWorkspaceDb()
        const current = readGameProject(db, ctx.projectId)
        if (!current.data.enabled) return error('本作品未启用游戏数值档案。')
        const chapterIndex = chapterIndexForGame(db, ctx.projectId, chapterId)
        const key = changeKey(input, characterId, operation)
        const existing = current.data.events.find((event) => event.status === 'draft' && event.source === 'ai'
          && event.aiRunId === aiRunId && event.aiChangeKey === key)
        if (existing) {
          const now = gameSnapshot(current.data, characterId, chapterIndex, chapterId)
          return { content: `本次运行已暂存过同一剧情节点，不再重复追加。当前：等级${now.level}，生命${now.currentResources.health}/${now.totals.health ?? 0}，魔法${now.currentResources.mana}/${now.totals.mana ?? 0}，属性${JSON.stringify(now.totals)}。` }
        }
        const preview = previewGameOperation(current.data, characterId, chapterIndex, chapterId, operation)
        applyGameCommand(db, ctx.projectId, current.revision, {
          kind: 'stage', characterId, chapterId, operation, source: 'ai', aiRunId, aiChangeKey: key,
          narrativeNote: String(input.narrative_note ?? '').trim()
        })
        return { content: `已暂存本章数值变化，待作者确认。操作：${JSON.stringify(operation)}。之前：等级${preview.before.level}，生命${preview.before.currentResources.health}，魔法${preview.before.currentResources.mana}，属性${JSON.stringify(preview.before.totals)}。之后：等级${preview.after.level}，生命${preview.after.currentResources.health}，魔法${preview.after.currentResources.mana}，属性${JSON.stringify(preview.after.totals)}。只按变化发生后的数值写后续场景。` }
      } catch (cause) { return error(cause instanceof Error ? cause.message : String(cause)) }
    }
  }]
}
