import assert from 'node:assert/strict'
import test from 'node:test'

import { validateStoryStateModuleSelection } from './project-archive-selection.ts'

test('只选故事状态不能隐式覆盖章节和角色', () => {
  assert.throws(
    () => validateStoryStateModuleSelection(new Set(['storyState']), true),
    /同时勾选“章节正文”和“角色与势力”/
  )
  assert.doesNotThrow(() => validateStoryStateModuleSelection(new Set(['storyState', 'chapters', 'characters']), true))
})

test('旧归档缺故事状态时不可假装导入，未选择状态仍可导入章节', () => {
  assert.throws(
    () => validateStoryStateModuleSelection(new Set(['storyState', 'chapters', 'characters']), false),
    /旧版归档不包含故事状态/
  )
  assert.doesNotThrow(() => validateStoryStateModuleSelection(new Set(['chapters']), false))
})
