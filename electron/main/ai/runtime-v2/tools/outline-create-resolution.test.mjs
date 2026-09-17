import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveOutlineCreate } from './outline-create-resolution.ts'

const existing = {
  id: 'outline-1',
  volumeId: 'volume-1',
  title: '黑泥鳅幼兽与返祖契约',
  wordTarget: '预估 3000字',
  conflict: '旧冲突',
  summary: '旧摘要',
  relatedCharacterIds: ['character-1'],
  relatedOrganizationIds: [],
  relatedWorldviewIds: []
}

test('同名但内容不同的大纲新增转换为修改', () => {
  const resolution = resolveOutlineCreate([existing], {
    ...existing,
    id: '',
    conflict: '新冲突',
    summary: '新摘要'
  })

  assert.equal(resolution.kind, 'update')
  assert.equal(resolution.existing.id, 'outline-1')
})

test('同名且内容相同的大纲新增直接跳过', () => {
  const resolution = resolveOutlineCreate([existing], { ...existing, id: '' })

  assert.equal(resolution.kind, 'skip')
})

test('不同标题仍作为新增处理', () => {
  const resolution = resolveOutlineCreate([existing], {
    ...existing,
    id: '',
    title: '新的剧情节点'
  })

  assert.equal(resolution.kind, 'create')
})
