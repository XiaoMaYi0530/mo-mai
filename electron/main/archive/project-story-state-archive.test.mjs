import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

import { initStoryStateSchema } from '../story-state-store.ts'
import { initStateBackfillSchema } from '../ai/state-backfill-store.ts'
import { readProjectStoryState, replaceProjectStoryState } from './project-story-state-archive.ts'

test('故事状态归档可映射项目、章节与候选人物卡，并清除目标旧状态', () => {
  const source = new DatabaseSync(':memory:')
  initStoryStateSchema(source)
  initStateBackfillSchema(source)
  source.prepare(`INSERT INTO story_character_state
    (id, project_id, character_id, chapter_index, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    'state-1', 'source', '林岚', 1, '2026-01-01'
  )
  source.prepare(`INSERT INTO story_state_backfill_chapters
    (project_id, chapter_id, chapter_index, chapter_title, content_hash, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('source', 'chapter-old', 1, '第一章', 'hash', 'success', '2026-01-01')
  source.prepare(`INSERT INTO story_state_backfill_chapters
    (project_id, chapter_id, chapter_index, chapter_title, content_hash, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('source', 'chapter-running', 2, '第二章', 'hash-2', 'running', '2026-01-01')
  source.prepare(`INSERT INTO story_entity_candidates
    (id, project_id, kind, normalized_name, name, linked_entity_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'candidate-1', 'source', 'character', '林岚', '林岚', 'card-old', '2026-01-01', '2026-01-01'
  )
  source.prepare(`INSERT INTO story_character_state_exclusions
    (project_id, character_id, deleted_at) VALUES (?, ?, ?)`).run('source', '一次性路人', '2026-01-01')
  source.prepare(`INSERT INTO story_relationships
    (id, project_id, relationship_id, participant_a, participant_b, current_status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run('relation-1', 'source', '林岚-顾川', '林岚', '顾川', '合作', '2026-01-01')
  source.prepare(`INSERT INTO story_relationship_history
    (id, project_id, relationship_id, chapter_index, to_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`).run('history-1', 'source', '林岚-顾川', 1, '合作', '2026-01-01')
  const archived = readProjectStoryState(source, 'source')

  const target = new DatabaseSync(':memory:')
  initStoryStateSchema(target)
  initStateBackfillSchema(target)
  target.prepare(`INSERT INTO story_character_state
    (id, project_id, character_id, chapter_index, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    'stale', 'target', '旧人', 1, '2026-01-01'
  )
  target.prepare(`INSERT INTO story_character_state
    (id, project_id, character_id, chapter_index, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    'other', 'other-project', '别的项目', 1, '2026-01-01'
  )
  replaceProjectStoryState(target, 'target', archived, new Map([
    ['chapter-old', 'chapter-new'], ['card-old', 'card-new']
  ]))
  assert.deepEqual(target.prepare('SELECT character_id FROM story_character_state WHERE project_id = ?').all('target').map((row) => row.character_id), ['林岚'])
  assert.equal(target.prepare('SELECT chapter_id FROM story_state_backfill_chapters WHERE project_id = ?').get('target').chapter_id, 'chapter-new')
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM story_state_backfill_chapters WHERE project_id = ?').get('target').count, 1)
  assert.equal(target.prepare('SELECT linked_entity_id FROM story_entity_candidates WHERE project_id = ?').get('target').linked_entity_id, 'card-new')
  assert.equal(target.prepare('SELECT character_id FROM story_character_state_exclusions WHERE project_id = ?').get('target').character_id, '一次性路人')
  assert.equal(target.prepare('SELECT relationship_id FROM story_relationship_history WHERE project_id = ?').get('target').relationship_id, '林岚-顾川')
  assert.equal(target.prepare('SELECT character_id FROM story_character_state WHERE project_id = ?').get('other-project').character_id, '别的项目')
  replaceProjectStoryState(target, 'target', {}, new Map())
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM story_character_state WHERE project_id = ?').get('target').count, 0)
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM story_relationship_history WHERE project_id = ?').get('target').count, 0)
  assert.equal(target.prepare('SELECT COUNT(*) AS count FROM story_character_state WHERE project_id = ?').get('other-project').count, 1)
})
