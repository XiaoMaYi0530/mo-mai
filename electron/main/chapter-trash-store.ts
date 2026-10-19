import type { DatabaseSync } from 'node:sqlite'
export function initChapterTrashSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS chapter_trash (project_id TEXT PRIMARY KEY, data_json TEXT NOT NULL DEFAULT '[]', FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE) STRICT;`)
}
export function readChapterTrash<T>(db: DatabaseSync, projectId: string): T[] {
  const row = db.prepare('SELECT data_json FROM chapter_trash WHERE project_id = ?').get(projectId) as { data_json: string } | undefined
  return row ? JSON.parse(row.data_json) : []
}
export function writeChapterTrash(db: DatabaseSync, projectId: string, entries: unknown[] | undefined) {
  // Older clients may omit this field; never erase the archive on their behalf.
  if (entries === undefined) return
  if (!Array.isArray(entries)) throw new Error('章节回收站数据无效。')
  db.prepare('INSERT INTO chapter_trash (project_id,data_json) VALUES (?,?) ON CONFLICT(project_id) DO UPDATE SET data_json=excluded.data_json').run(projectId, JSON.stringify(entries))
}

/** Call inside the same transaction as DELETE so history can never be lost halfway. */
export function archiveChapterBeforeDelete(db: DatabaseSync, projectId: string, chapterId: string) {
  const chapter = db.prepare(`SELECT id, volume_id AS volumeId, outline_item_id AS outlineItemId,
    title, summary, status, word_target AS wordTarget, content FROM chapters WHERE project_id=? AND id=?`).get(projectId, chapterId)
  if (!chapter) throw new Error('章节不存在。')
  const chapters = db.prepare('SELECT id FROM chapters WHERE project_id=? ORDER BY sort_order ASC, rowid ASC').all(projectId)
  const versions = db.prepare(`SELECT id, chapter_id AS chapterId, title, summary, status,
    word_target AS wordTarget, content, created_at AS createdAt FROM chapter_versions WHERE project_id=? AND chapter_id=?`).all(projectId, chapterId)
  writeChapterTrash(db, projectId, [...readChapterTrash(db, projectId), {
    id: chapterId, chapter, versions, deletedAt: new Date().toISOString(), originalIndex: chapters.findIndex(c => c.id === chapterId)
  }])
}
