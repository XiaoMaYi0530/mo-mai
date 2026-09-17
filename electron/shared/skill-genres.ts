/** Skill 适用题材。`general` 表示不限制项目题材。 */
export type SkillGenreId =
  | 'general'
  | 'xianxia'
  | 'xuanhuan'
  | 'urban'
  | 'romance'
  | 'mystery'
  | 'scifi'
  | 'historical'
  | 'wuxia'
  | 'game'
  | 'fantasy'
  | 'apocalypse'

export const SKILL_GENRE_LABELS: Record<SkillGenreId, string> = {
  general: '通用题材',
  xianxia: '仙侠修真',
  xuanhuan: '玄幻高武',
  urban: '都市',
  romance: '言情',
  mystery: '悬疑推理',
  scifi: '科幻',
  historical: '历史',
  wuxia: '武侠',
  game: '游戏电竞',
  fantasy: '奇幻',
  apocalypse: '末日废土'
}

const GENRE_PATTERNS: Array<{ id: Exclude<SkillGenreId, 'general'>; patterns: RegExp[] }> = [
  { id: 'xianxia', patterns: [/仙侠/, /修真/, /修仙/, /cultivation/i] },
  { id: 'xuanhuan', patterns: [/玄幻/, /高武/, /xuanhuan/i] },
  { id: 'urban', patterns: [/都市/, /职场/, /商战/] },
  { id: 'romance', patterns: [/言情/, /爱情/, /古言/, /现言/, /女频/] },
  { id: 'mystery', patterns: [/悬疑/, /推理/, /刑侦/] },
  { id: 'scifi', patterns: [/科幻/, /星际/, /science\s*fiction/i, /sci-?fi/i] },
  { id: 'historical', patterns: [/历史/, /朝堂/, /架空古代/] },
  { id: 'wuxia', patterns: [/武侠/, /江湖/] },
  { id: 'game', patterns: [/游戏/, /电竞/, /网游/] },
  { id: 'fantasy', patterns: [/奇幻/, /魔法/, /西幻/] },
  { id: 'apocalypse', patterns: [/末日/, /废土/, /丧尸/] }
]

export function normalizeSkillGenreIds(value: unknown): SkillGenreId[] {
  if (!Array.isArray(value)) return []
  const valid = new Set<SkillGenreId>(Object.keys(SKILL_GENRE_LABELS) as SkillGenreId[])
  return [...new Set(value.map((item) => String(item ?? '').trim().toLowerCase()).filter((id): id is SkillGenreId => valid.has(id as SkillGenreId)))]
}

/** 从项目题材或 Skill 描述中识别稳定题材 ID。识别不到时返回空数组。 */
export function detectSkillGenres(text: string): Exclude<SkillGenreId, 'general'>[] {
  const source = String(text ?? '').normalize('NFKC')
  return GENRE_PATTERNS.filter((item) => item.patterns.some((pattern) => pattern.test(source))).map((item) => item.id)
}

/** 未声明题材的旧 Skill 按通用处理，保证兼容。 */
export function resolveEffectiveSkillGenres(genreIds?: readonly string[]): SkillGenreId[] {
  const normalized = normalizeSkillGenreIds(genreIds)
  return normalized.length > 0 ? normalized : ['general']
}

export function formatSkillGenreLabels(genreIds?: readonly string[]): string {
  return resolveEffectiveSkillGenres(genreIds).map((id) => SKILL_GENRE_LABELS[id]).join('、')
}

export type SkillGenreMatch = 'general' | 'match' | 'mismatch' | 'unknown-project'

/** 判断 Skill 与当前项目题材的关系；通用 Skill 永远可用。 */
export function matchSkillGenre(genreIds: readonly string[] | undefined, projectGenre: string): SkillGenreMatch {
  const effective = resolveEffectiveSkillGenres(genreIds)
  if (effective.includes('general')) return 'general'
  const projectGenres = detectSkillGenres(projectGenre)
  if (projectGenres.length === 0) return 'unknown-project'
  return effective.some((genre) => projectGenres.includes(genre as Exclude<SkillGenreId, 'general'>))
    ? 'match'
    : 'mismatch'
}
