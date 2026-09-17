import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProjectStyleFingerprintContext,
  normalizeStyleFingerprintBinding,
  remapStyleFingerprintBinding
} from './style-fingerprint-binding.ts'

test('旧参考作品选择会迁移为 80/20 的项目指纹绑定', () => {
  assert.deepEqual(normalizeStyleFingerprintBinding(undefined, ['a', 'b']), {
    version: 1,
    primaryReferenceWorkId: 'a',
    primaryWeight: 80,
    auxiliary: [{ referenceWorkId: 'b', weight: 20 }]
  })
})

test('解析主辅指纹并按配置权重生成统一上下文', () => {
  const result = buildProjectStyleFingerprintContext({
    binding: { primaryReferenceWorkId: 'a', primaryWeight: 80, auxiliary: [{ referenceWorkId: 'b', weight: 20 }] },
    referenceWorks: [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }],
    documents: [
      { id: 'fa', title: '甲作者风格指纹', content: '甲风格', sourceType: 'reference-summary', metadata: { documentKind: 'author-fingerprint', referenceWorkId: 'a' }, updatedAt: '2026-01-02' },
      { id: 'fb', title: '乙作者风格指纹', content: '乙风格', sourceType: 'reference-summary', metadata: { documentKind: 'author-fingerprint', referenceWorkId: 'b' }, updatedAt: '2026-01-03' }
    ]
  })
  assert.match(result.context, /主风格 80%｜甲/)
  assert.match(result.context, /辅助风格 20%｜乙/)
  assert.deepEqual(result.entries.map((entry) => entry.effectiveWeight), [80, 20])
})

test('缺失辅助指纹时只注入已就绪指纹并重新归一化', () => {
  const result = buildProjectStyleFingerprintContext({
    binding: { primaryReferenceWorkId: 'a', primaryWeight: 80, auxiliary: [{ referenceWorkId: 'b', weight: 20 }] },
    referenceWorks: [{ id: 'a', title: '甲' }, { id: 'b', title: '乙' }],
    documents: [{ id: 'fa', title: '指纹', content: '甲风格', sourceType: 'reference-summary', metadata: { documentKind: 'author-fingerprint', referenceWorkId: 'a' } }]
  })
  assert.equal(result.entries[0].effectiveWeight, 100)
  assert.equal(result.entries[1].status, 'missing')
  assert.equal(result.warnings.length, 1)
})

test('归档导入可统一重映射绑定 ID', () => {
  assert.deepEqual(remapStyleFingerprintBinding({ primaryReferenceWorkId: 'a', primaryWeight: 75, auxiliary: [{ referenceWorkId: 'b', weight: 25 }] }, (id) => `new-${id}`), {
    version: 1,
    primaryReferenceWorkId: 'new-a',
    primaryWeight: 75,
    auxiliary: [{ referenceWorkId: 'new-b', weight: 25 }]
  })
})
