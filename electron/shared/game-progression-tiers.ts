export const GAME_PROGRESSION_TIER_IDS = ['starter', 'growth', 'elite', 'master', 'legendary'] as const
export type GameProgressionTier = typeof GAME_PROGRESSION_TIER_IDS[number]

export interface GameTierRules {
  growthLevel: number
  eliteLevel: number
  masterLevel: number
  legendaryLevel: number
}

export const GAME_DEFAULT_TIER_RULES: GameTierRules = {
  growthLevel: 11,
  eliteLevel: 26,
  masterLevel: 51,
  legendaryLevel: 81
}

export const GAME_TIER_LABELS: Record<GameProgressionTier, string> = {
  starter: '入门', growth: '成长', elite: '精锐', master: '大师', legendary: '传说'
}

export function normalizeGameTierRules(rules?: Partial<GameTierRules>): GameTierRules {
  return { ...GAME_DEFAULT_TIER_RULES, ...(rules ?? {}) }
}

export function assertGameTierRules(rules: GameTierRules): void {
  const levels = [rules.growthLevel, rules.eliteLevel, rules.masterLevel, rules.legendaryLevel]
  if (!levels.every((level) => Number.isSafeInteger(level) && level >= 2 && level <= 1000)
    || levels.some((level, index) => index > 0 && level <= levels[index - 1]!)) {
    throw new Error('成长位阶起始等级必须是 2–1000 内严格递增的整数。')
  }
}

export function gameProgressionTierForLevel(level: number, rules?: Partial<GameTierRules>): GameProgressionTier {
  const normalized = normalizeGameTierRules(rules)
  if (level >= normalized.legendaryLevel) return 'legendary'
  if (level >= normalized.masterLevel) return 'master'
  if (level >= normalized.eliteLevel) return 'elite'
  if (level >= normalized.growthLevel) return 'growth'
  return 'starter'
}

export type GameGeneratedRarity = '普通' | '精良' | '稀有' | '史诗' | '传说'

const TIER_RARITY_CUMULATIVE: Record<GameProgressionTier, Array<[GameGeneratedRarity, number]>> = {
  starter: [['普通', 0.7], ['精良', 0.94], ['稀有', 0.99], ['史诗', 0.999], ['传说', 1]],
  growth: [['普通', 0.52], ['精良', 0.82], ['稀有', 0.96], ['史诗', 0.995], ['传说', 1]],
  elite: [['普通', 0.3], ['精良', 0.65], ['稀有', 0.88], ['史诗', 0.98], ['传说', 1]],
  master: [['普通', 0.14], ['精良', 0.42], ['稀有', 0.74], ['史诗', 0.94], ['传说', 1]],
  legendary: [['普通', 0.05], ['精良', 0.23], ['稀有', 0.53], ['史诗', 0.83], ['传说', 1]]
}

export function generatedRarityForTier(tier: GameProgressionTier, randomValue: number): GameGeneratedRarity {
  const value = Math.min(0.999999999, Math.max(0, randomValue))
  return TIER_RARITY_CUMULATIVE[tier].find(([, ceiling]) => value < ceiling)?.[0] ?? '传说'
}
