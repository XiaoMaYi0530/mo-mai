import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatStagedReferenceNames,
  resolveStagedReferenceText
} from './staged-reference-labels.ts'

const catalog = {
  characters: [{ id: 'character-1', name: '林砚' }],
  organizations: [{ id: 'organization-1', name: '观星院' }],
  worldviewEntries: [{ id: 'world-1', title: '星纹法则' }]
}

test('暂存变更中的关联实体 ID 转换为可读名称', () => {
  const legacyText = [
    '关联角色 ID：character-1',
    '关联组织 ID：organization-1',
    '关联设定 ID：world-1'
  ].join('\n')

  assert.equal(resolveStagedReferenceText(legacyText, catalog), [
    '关联人物：林砚',
    '关联组织：观星院',
    '关联设定：星纹法则'
  ].join('\n'))
})

test('新暂存变更格式化名称，同时为失效引用保留可诊断信息', () => {
  assert.equal(
    formatStagedReferenceNames(['character-1', 'character-missing'], catalog, 'character'),
    '林砚 / 未找到（character-missing）'
  )
})
