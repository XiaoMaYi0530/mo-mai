import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

// 向量缓存可重新生成，不属于项目的原始创作资料。
const STORY_TABLES = [
  'story_character_state',
  'story_character_state_exclusions',
  'story_foreshadowing',
  'story_relationships',
  'story_relationship_history',
  'story_timeline',
  'story_world_rules',
  'story_countdown_clocks',
  'story_entity_candidates',
  'story_state_backfill_chapters'
] as const

type StoryTable = typeof STORY_TABLES[number]
type StoryRow = Record<string, string | number | null>
export type ProjectStoryStateArchive = Partial<Record<StoryTable, StoryRow[]>>

function tableExists(db: DatabaseSync, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table))
}

export function countProjectStoryState(archive: ProjectStoryStateArchive): number {
  return STORY_TABLES.reduce((count, table) => count + (archive[table]?.length ?? 0), 0)
}

export function readProjectStoryState(db: DatabaseSync, projectId: string): ProjectStoryStateArchive {
  const result: ProjectStoryStateArchive = {}
  for (const table of STORY_TABLES) {
    result[table] = tableExists(db, table)
      ? db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId) as StoryRow[]
      : []
  }
  return result
}

/** 用归档内容替换目标项目的状态；空归档也会清除旧状态，避免正文已覆盖后遗留旧书剧情。 */
export function replaceProjectStoryState(
  db: DatabaseSync,
  projectId: string,
  archive: ProjectStoryStateArchive,
  idMap: Map<string, string>
): void {
  db.exec('BEGIN')
  try {
    for (const table of STORY_TABLES) {
      if (!tableExists(db, table)) continue
      db.prepare(`DELETE FROM ${table} WHERE project_id = ?`).run(projectId)
      const columns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name))
      for (const original of archive[table] ?? []) {
        // 归档时仍在扫描的任务不能在新项目中恢复为“运行中”，交给补录列表重新识别。
        if (table === 'story_state_backfill_chapters' && original.status === 'running') continue
        const row: StoryRow = { ...original, project_id: projectId }
        if (typeof row.id === 'string') row.id = randomUUID()
        if (table === 'story_state_backfill_chapters' && typeof row.chapter_id === 'string') {
          row.chapter_id = idMap.get(row.chapter_id) ?? row.chapter_id
        }
        if (table === 'story_entity_candidates' && typeof row.linked_entity_id === 'string') {
          row.linked_entity_id = idMap.get(row.linked_entity_id) ?? row.linked_entity_id
        }
        const keys = Object.keys(row).filter((key) => columns.has(key))
        db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
          .run(...keys.map((key) => row[key]))
      }
    }
    // 向量缓存以原项目内容为基础，覆盖章节后必须失效。
    if (tableExists(db, 'story_embeddings')) {
      db.prepare('DELETE FROM story_embeddings WHERE project_id = ?').run(projectId)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
