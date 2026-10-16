import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertGameTierRules,
  gameProgressionTierForLevel,
  generatedRarityForTier
} from './game-progression-tiers.ts'

test('作品等级按照可配置分界映射到五个成长位阶', () => {
  assert.equal(gameProgressionTierForLevel(1), 'starter')
  assert.equal(gameProgressionTierForLevel(10), 'starter')
  assert.equal(gameProgressionTierForLevel(11), 'growth')
  assert.equal(gameProgressionTierForLevel(26), 'elite')
  assert.equal(gameProgressionTierForLevel(51), 'master')
  assert.equal(gameProgressionTierForLevel(81), 'legendary')
  assert.equal(gameProgressionTierForLevel(20, { growthLevel: 5, eliteLevel: 10, masterLevel: 15, legendaryLevel: 20 }), 'legendary')
})

test('位阶分界必须严格递增', () => {
  assert.throws(() => assertGameTierRules({ growthLevel: 10, eliteLevel: 10, masterLevel: 30, legendaryLevel: 40 }), /严格递增/)
})

test('混合品质随成长位阶提高而改变，而不是全等级使用同一概率', () => {
  assert.equal(generatedRarityForTier('starter', 0.6), '普通')
  assert.equal(generatedRarityForTier('legendary', 0.6), '史诗')
  assert.equal(generatedRarityForTier('starter', 0.995), '史诗')
  assert.equal(generatedRarityForTier('legendary', 0.9), '传说')
})
