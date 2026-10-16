import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import * as XLSX from 'xlsx'
import type { GameAsset, GameAssetKind, GameSkillDetails, GameSkillOutcome, GameSkillTarget } from '../shared/game-progression'
import { completeGameSkillDetails, gameSnapshot, previewGameOperation, searchGameAssets } from '../shared/game-progression'
import { applyGameCommand, chapterIndexForGame, readGameProject, rollbackAiGameRun, type GameCommand } from './game-progression-store'

type Dependencies = {
  ensureWorkspaceDb: () => Promise<DatabaseSync>
  getActiveWindow: () => BrowserWindow | null
}

function textCell(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function parseKind(value: string): GameAssetKind {
  if (['equipment', '装备'].includes(value)) return 'equipment'
  if (['title', '称号'].includes(value)) return 'title'
  if (['special', '特殊物品', '特殊道具'].includes(value)) return 'special'
  if (['skill', '技能'].includes(value)) return 'skill'
  throw new Error(`类型“${value || '空'}”无效；应为装备、称号、特殊物品或技能。`)
}

function parseNumber(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`${label}不是有效数字。`)
  return parsed
}

function parseSkillType(value: string): GameSkillDetails['type'] {
  const types: Record<string, GameSkillDetails['type']> = {
    spell: 'spell', '法术': 'spell', combat: 'combat', '战技': 'combat', movement: 'movement', '身法': 'movement',
    healing: 'healing', '治疗': 'healing', control: 'control', '控制': 'control', support: 'support', '辅助': 'support'
  }
  const parsed = types[value || '法术']
  if (!parsed) throw new Error(`技能类型“${value}”无效。`)
  return parsed
}

function parseSkillTarget(value: string): GameSkillTarget {
  const values: Record<string, GameSkillTarget> = { self: 'self', '自身': 'self', single: 'single', '单体': 'single', line: 'line', '直线': 'line', cone: 'cone', '扇形': 'cone', area: 'area', '范围': 'area', multiple: 'multiple', '多目标': 'multiple' }
  return values[value] ?? 'single'
}

function parseSkillOutcome(value: string): GameSkillOutcome {
  const values: Record<string, GameSkillOutcome> = { damage: 'damage', '伤害': 'damage', healing: 'healing', '治疗': 'healing', shield: 'shield', '护盾': 'shield', movement: 'movement', '位移': 'movement', control: 'control', '控制': 'control', buff: 'buff', '增益': 'buff', debuff: 'debuff', '减益': 'debuff', summon: 'summon', '召唤': 'summon' }
  return values[value] ?? 'damage'
}

function parseAssetRows(rows: Record<string, unknown>[], data: ReturnType<typeof readGameProject>['data']): GameAsset[] {
  const assets: GameAsset[] = []
  const errors: string[] = []
  rows.filter((row) => Object.values(row).some((cell) => String(cell ?? '').trim())).forEach((row, index) => {
    const line = index + 2
    try {
      const name = textCell(row, 'name', '名称', '物品名称', '装备名称', '称号名称')
      if (!name) throw new Error('名称为空。')
      const kind = parseKind(textCell(row, 'kind', '类型') || '装备')
      const id = textCell(row, 'id', 'ID', '编号') || `import-${createHash('sha256').update(`${kind}:${name}`).digest('hex').slice(0, 16)}`
      const activationText = textCell(row, 'activation', '生效方式')
      if (activationText && !['持有', 'owned', '激活', 'active', '装备', 'equipped', '学习', 'learned'].includes(activationText)) {
        throw new Error(`生效方式“${activationText}”无效。`)
      }
      const activation = activationText === '持有' || activationText === 'owned' ? 'owned'
        : activationText === '装备' || activationText === 'equipped' ? 'equipped'
          : activationText === '激活' || activationText === 'active' ? 'active'
            : activationText === '学习' || activationText === 'learned' ? 'learned'
              : kind === 'equipment' ? 'equipped' : kind === 'skill' ? 'learned' : 'active'
      const rawSlot = kind === 'skill' ? '' : textCell(row, 'slotId', '槽位')
      const slotId = data.slots.find((slot) => slot.id === rawSlot || slot.name === rawSlot)?.id ?? rawSlot
      if ((kind === 'equipment' || activation === 'equipped') && !slotId) throw new Error('装备需要填写“槽位”列。')
      const bonuses: Record<string, number> = {}
      for (const stat of data.stats) {
        const value = textCell(row, stat.id, stat.name, `属性:${stat.name}`, `属性：${stat.name}`)
        if (value) bonuses[stat.id] = parseNumber(value, stat.name)
      }
      const skill = kind === 'skill' ? completeGameSkillDetails({
        type: parseSkillType(textCell(row, 'skillType', '技能类型')),
        element: textCell(row, 'element', '元素', '属性') || '无属性',
        manaCost: Math.max(1, parseNumber(textCell(row, 'manaCost', '魔法消耗', '耗蓝') || 1, '魔法消耗')),
        cooldownSeconds: Math.max(0, parseNumber(textCell(row, 'cooldownSeconds', '冷却秒数', '冷却'), '冷却秒数')),
        castTimeSeconds: Math.max(0, parseNumber(textCell(row, 'castTimeSeconds', '施法时间'), '施法时间')),
        range: textCell(row, 'range', '范围') || '近身',
        effect: textCell(row, 'effect', '技能效果') || textCell(row, 'description', '描述', '说明'),
        target: parseSkillTarget(textCell(row, 'target', '目标类型')),
        outcome: parseSkillOutcome(textCell(row, 'outcome', '作用类型')),
        scalingStatId: textCell(row, 'scalingStatId', '加成属性') || 'spellPower',
        powerMultiplier: parseNumber(textCell(row, 'powerMultiplier', '属性倍率') || 1, '属性倍率'),
        flatPower: parseNumber(textCell(row, 'flatPower', '基础数值'), '基础数值'),
        durationSeconds: parseNumber(textCell(row, 'durationSeconds', '持续秒数'), '持续秒数'),
        maxStacks: Math.max(1, parseNumber(textCell(row, 'maxStacks', '最大叠层') || 1, '最大叠层')),
        condition: textCell(row, 'condition', '使用条件'), sideEffect: textCell(row, 'sideEffect', '副作用'),
        prose: textCell(row, 'prose', '小说表现')
      }) : undefined
      assets.push({
        id, kind, name,
        aliases: textCell(row, 'aliases', '别名').split(/[,，;；]/).map((value) => value.trim()).filter(Boolean),
        description: textCell(row, 'description', '描述', '说明'),
        rarity: textCell(row, 'rarity', '品质', '稀有度'),
        tags: textCell(row, 'tags', '标签').split(/[,，;；]/).map((value) => value.trim()).filter(Boolean),
        slotId,
        activation,
        levelRequirement: parseNumber(textCell(row, 'levelRequirement', '等级要求'), '等级要求'),
        bonuses,
        source: 'import' as const,
        ...(skill ? { skill } : {})
      })
    } catch (error) {
      errors.push(`第 ${line} 行：${error instanceof Error ? error.message : String(error)}`)
    }
  })
  if (errors.length) {
    const visible = errors.slice(0, 20).join('\n')
    throw new Error(`导入表有 ${errors.length} 行需要修正：\n${visible}${errors.length > 20 ? `\n另有 ${errors.length - 20} 行未显示。` : ''}`)
  }
  return assets
}

export function registerGameProgressionIpc(deps: Dependencies): void {
  ipcMain.handle('characterarc:game-read', async (_event, projectId: string) => {
    try {
      return { success: true, result: readGameProject(await deps.ensureWorkspaceDb(), projectId) }
    } catch (error) { return { success: false, error: String(error) } }
  })
  ipcMain.handle('characterarc:game-command', async (_event, request: {
    projectId: string; expectedRevision: number; command: GameCommand
  }) => {
    try {
      return { success: true, result: applyGameCommand(await deps.ensureWorkspaceDb(), request.projectId, request.expectedRevision, request.command) }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('characterarc:game-rollback-ai-run', async (_event, request: { projectId: string; aiRunId: string }) => {
    try {
      return { success: true, result: rollbackAiGameRun(await deps.ensureWorkspaceDb(), request.projectId, request.aiRunId) }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('characterarc:game-snapshot', async (_event, request: {
    projectId: string; characterId: string; chapterId: string
  }) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const { data } = readGameProject(db, request.projectId)
      const chapterIndex = chapterIndexForGame(db, request.projectId, request.chapterId)
      return { success: true, result: gameSnapshot(data, request.characterId, chapterIndex, request.chapterId) }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('characterarc:game-preview', async (_event, request: {
    projectId: string; characterId: string; chapterId: string; operation: Parameters<typeof previewGameOperation>[4]
  }) => {
    try {
      const db = await deps.ensureWorkspaceDb()
      const { data } = readGameProject(db, request.projectId)
      const chapterIndex = chapterIndexForGame(db, request.projectId, request.chapterId)
      return { success: true, result: previewGameOperation(data, request.characterId, chapterIndex, request.chapterId, request.operation) }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('characterarc:game-search', async (_event, request: {
    projectId: string; query: string; kind?: GameAssetKind
  }) => {
    try {
      const { data } = readGameProject(await deps.ensureWorkspaceDb(), request.projectId)
      return { success: true, result: searchGameAssets(data, request.query, request.kind) }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('characterarc:game-import-preview', async (_event, projectId: string) => {
    try {
      const window = deps.getActiveWindow()
      const options = { title: '导入装备、称号、特殊物品或技能目录', properties: ['openFile'] as Array<'openFile'>,
        filters: [{ name: '表格', extensions: ['xlsx', 'xls', 'csv'] }] }
      const picked = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      if (picked.canceled || !picked.filePaths[0]) return { success: true, canceled: true }
      const filePath = picked.filePaths[0]
      const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      if (!sheet) throw new Error('表格没有工作表。')
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
      const { data } = readGameProject(await deps.ensureWorkspaceDb(), projectId)
      const assets = parseAssetRows(rows, data)
      return { success: true, canceled: false, result: { fileName: basename(filePath), assets } }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
  ipcMain.handle('characterarc:game-export-template', async (_event, projectId: string) => {
    try {
      const window = deps.getActiveWindow()
      const picked = window
        ? await dialog.showSaveDialog(window, { title: '保存游戏物品导入模板', defaultPath: '墨脉-游戏物品导入模板.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
        : await dialog.showSaveDialog({ title: '保存游戏物品导入模板', defaultPath: '墨脉-游戏物品导入模板.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] })
      if (picked.canceled || !picked.filePath) return { success: true, canceled: true }
      const { data } = readGameProject(await deps.ensureWorkspaceDb(), projectId)
      const example: Record<string, string | number> = {
        ID: 'example-blade', 名称: '示例铁剑', 类型: '装备', 槽位: data.slots[0]?.name ?? '武器',
        品质: '普通', 等级要求: 1, 生效方式: '装备', 描述: '示例行，可删除', 别名: '', 标签: '示例',
        技能类型: '', 元素: '', 魔法消耗: '', 冷却秒数: '', 施法时间: '', 范围: '', 技能效果: ''
      }
      for (const stat of data.stats) example[stat.name] = stat.id === data.stats[0]?.id ? 5 : 0
      const skillExample: Record<string, string | number> = {
        ...Object.fromEntries(Object.keys(example).map((key) => [key, ''])),
        ID: 'example-fireball', 名称: '示例火球术', 类型: '技能', 品质: '普通', 等级要求: 1, 生效方式: '学习',
        描述: '发射火球攻击目标。', 标签: '法术，火系', 技能类型: '法术', 元素: '火', 魔法消耗: 10,
        冷却秒数: 4, 施法时间: 1, 范围: '中距离', 技能效果: '造成火焰伤害。', 目标类型: '单体',
        作用类型: '伤害', 加成属性: 'spellPower', 属性倍率: 1.2, 基础数值: 25, 持续秒数: 0, 最大叠层: 1,
        使用条件: '', 副作用: '', 小说表现: '火光在掌心压缩成球，拖着尾焰撞向目标。'
      }
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([example, skillExample]), '装备与技能目录')
      await writeFile(picked.filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }))
      return { success: true, canceled: false, filePath: picked.filePath }
    } catch (error) { return { success: false, error: error instanceof Error ? error.message : String(error) } }
  })
}
