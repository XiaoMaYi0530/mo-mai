import assert from 'node:assert/strict'
import test from 'node:test'

import { readFileSync } from 'node:fs'
import { normalizeTutorial, resolveFreshTutorial } from './tutorials-core.ts'

const LOCAL_TUTORIAL = normalizeTutorial(JSON.parse(
  readFileSync(new URL('../../../../tutorial.json', import.meta.url), 'utf8')
))
assert.ok(LOCAL_TUTORIAL)

test('本地教程包含仓库图文教程和待发布的视频入口', () => {
  assert.equal(LOCAL_TUTORIAL.resources.find((item) => item.type === 'github')?.url, 'https://github.com/XiaoMaYi0530/mo-mai/blob/main/docs/user-guide.md')
  assert.equal(LOCAL_TUTORIAL.resources.some((item) => item.type === 'bilibili' && item.enabled === false), true)
})

test('远程教程更新时替换本地内容', () => {
  const resolution = resolveFreshTutorial({
    version: 2,
    updatedAt: '2026-08-07',
    title: '远程教程',
    resources: [{ id: 'remote', type: 'bilibili', title: '视频', description: '', url: 'https://www.bilibili.com/video/BV1', enabled: true }]
  }, {
    ...LOCAL_TUTORIAL,
    updatedAt: '2026-08-06'
  })

  assert.equal(resolution.stale, false)
  assert.equal(resolution.document.title, '远程教程')
})

test('过期或非法远程教程回退本地内容', () => {
  const fallback = { ...LOCAL_TUTORIAL, updatedAt: '2026-08-06' }
  assert.equal(resolveFreshTutorial({ title: '旧教程', updatedAt: '2026-08-01', resources: [{ title: '旧', url: 'https://example.com' }] }, fallback).stale, true)
  assert.equal(resolveFreshTutorial({ title: '无效' }, fallback).document, fallback)
  assert.equal(normalizeTutorial({ title: '无效', resources: [] }), null)
})
