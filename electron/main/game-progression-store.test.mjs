import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { emptyGameCharacter, gameSnapshot } from '../shared/game-progression.ts'
import { DEFAULT_PERMISSION_MATRIX } from '../shared/assistant-runtime.ts'
import { applyGameCommand, buildGameWritingContext, chapterIndexForGame, clearAiDraftEventsForChapter, commitGameEventsForFinalChapters, initGameProgressionSchema, readGameProject, rollbackAiGameRun, validateImportedGameProject } from './game-progression-store.ts'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE projects (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE characters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL) STRICT;
    CREATE TABLE chapters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;
    INSERT INTO projects VALUES ('p');
    INSERT INTO characters VALUES ('hero', 'p', '林岚');
    INSERT INTO chapters VALUES ('c1', 'p', '第一章', 'draft', 0);
    INSERT INTO chapters VALUES ('c2', 'p', '第二章', 'draft', 1);`)
  initGameProgressionSchema(db)
  return db
}

test('按章节记录升级、换装，预览与确认后的后续章节严格一致', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'upsert-asset', asset: {
    id: 'blade', kind: 'equipment', name: '铁剑', aliases: [], description: '', rarity: '', tags: [],
    slotId: 'mainhand', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 7 }, source: 'manual'
  } })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'acquire', assetId: 'blade', quantity: 1 } })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'equip', assetId: 'blade' } })
  assert.equal(gameSnapshot(state.data, 'hero', 0, 'c1').totals.attack, 7)
  assert.equal(gameSnapshot(state.data, 'hero', 1, 'c2').totals.attack, 0)
  assert.match(buildGameWritingContext(db, 'p', 'c1', ['hero']), /林岚/)
  assert.match(buildGameWritingContext(db, 'p', 'c1', ['hero']), /获得铁剑/)
  db.exec("UPDATE chapters SET status = 'final' WHERE id = 'c1'")
  commitGameEventsForFinalChapters(db)
  assert.equal(readGameProject(db, 'p').data.events.every((event) => event.status === 'committed'), true)
  assert.match(buildGameWritingContext(db, 'p', 'c1', ['hero']), /本章已记录的变化/)
  assert.equal(gameSnapshot(readGameProject(db, 'p').data, 'hero', 1, 'c2').totals.attack, 7)
})

test('拒绝未知物品与旧版本并发写入，撤销本章草稿不影响后续', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  assert.throws(() => applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'equip', assetId: 'fake' } }), /已确认目录/)
  const oldRevision = state.revision
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'level-up', levels: 1 } })
  assert.throws(() => applyGameCommand(db, 'p', oldRevision, { kind: 'stage', characterId: 'hero', chapterId: 'c2', operation: { kind: 'level-up', levels: 1 } }), /其他窗口更新/)
  assert.equal(chapterIndexForGame(db, 'p', 'c2'), 1)
  state = applyGameCommand(db, 'p', state.revision, { kind: 'remove-event', eventId: state.data.events[0].id })
  assert.equal(gameSnapshot(state.data, 'hero', 1, 'c2').level, 1)
})

test('章节重排会重算事件顺序，删除章节时保留但停用孤儿记录', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'level-up', levels: 1 } })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'commit-chapter', chapterId: 'c1' })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'reopen-chapter', chapterId: 'c1' })
  assert.equal(state.data.events[0].status, 'draft')
  state = applyGameCommand(db, 'p', state.revision, { kind: 'commit-chapter', chapterId: 'c1' })
  db.exec("UPDATE chapters SET sort_order = 3 WHERE id = 'c1'")
  commitGameEventsForFinalChapters(db)
  state = readGameProject(db, 'p')
  assert.equal(state.data.events[0].chapterIndex, 1)
  assert.equal(gameSnapshot(state.data, 'hero', 0, 'c2').level, 1)
  db.exec("DELETE FROM chapters WHERE id = 'c1'")
  commitGameEventsForFinalChapters(db)
  state = readGameProject(db, 'p')
  assert.equal(state.data.events[0].orphaned, true)
  assert.equal(gameSnapshot(state.data, 'hero', 0, 'c2').level, 1)
})

test('归档导入校验人物引用与事件操作，不接受虚构目录数据', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  assert.equal(validateImportedGameProject(db, 'p', state.data).characters[0].characterId, 'hero')
  const invalid = structuredClone(state.data)
  invalid.characters[0].owned = { imaginary: 1 }
  assert.throws(() => validateImportedGameProject(db, 'p', invalid), /未确认物品/)
})

test('新版章节助手能读取并暂存游戏变化，内联小助手不能越权写入', () => {
  assert.ok(DEFAULT_PERMISSION_MATRIX['chapter-panel'].includes('stage_game_change'))
  assert.ok(!DEFAULT_PERMISSION_MATRIX['inline-selection'].includes('stage_game_change'))
})

test('同一次 AI 运行重试相同变化时只暂存一次', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  const command = {
    kind: 'stage', characterId: 'hero', chapterId: 'c1',
    operation: { kind: 'level-up', levels: 1 }, source: 'ai', aiRunId: 'run-1', aiChangeKey: 'beat-level-up'
  }
  state = applyGameCommand(db, 'p', state.revision, command)
  state = applyGameCommand(db, 'p', state.revision, command)
  assert.equal(state.data.events.length, 1)
  assert.equal(gameSnapshot(state.data, 'hero', 0, 'c1').level, 2)
})

test('失败运行只回滚自己尚未确认的 AI 变化，重新生成会替换旧 AI 草稿', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'level-up', levels: 1 }, source: 'manual' })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'level-up', levels: 1 }, source: 'ai', aiRunId: 'failed', aiChangeKey: 'one' })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c2', operation: { kind: 'level-up', levels: 1 }, source: 'ai', aiRunId: 'other', aiChangeKey: 'two' })
  state = rollbackAiGameRun(db, 'p', 'failed')
  assert.deepEqual(state.data.events.map((event) => event.source), ['manual', 'ai'])
  state = clearAiDraftEventsForChapter(db, 'p', 'c2')
  assert.equal(state.data.events.length, 1)
  assert.equal(state.data.events[0].source, 'manual')
})

test('改变每级点数只影响未来升级，不重写已记录历史', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true, pointsPerLevel: 5 })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'level-up', levels: 1 } })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'commit-chapter', chapterId: 'c1' })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'configure', pointsPerLevel: 10 })
  assert.equal(gameSnapshot(state.data, 'hero', 1, 'c2').freePoints, 5)
})

test('已删除的人物不会继续进入写作上下文', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  db.exec("DELETE FROM characters WHERE id = 'hero'")
  assert.equal(buildGameWritingContext(db, 'p', 'c1', ['hero']), '')
  commitGameEventsForFinalChapters(db)
  assert.equal(readGameProject(db, 'p').data.characters.length, 0)
})

test('初始穿戴也必须满足装备等级要求', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'upsert-asset', asset: {
    id: 'late-blade', kind: 'equipment', name: '十级剑', aliases: [], description: '', rarity: '', tags: [],
    slotId: 'mainhand', activation: 'equipped', levelRequirement: 10, bonuses: { attack: 7 }, source: 'manual'
  } })
  const seed = emptyGameCharacter('hero', state.data)
  seed.owned['late-blade'] = 1
  seed.equipped.mainhand = 'late-blade'
  assert.throws(() => applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: seed }), /等级不足/)
})

test('只有空人物档案时仍可调整属性与装备槽定义', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  state = applyGameCommand(db, 'p', state.revision, {
    kind: 'configure',
    stats: [{ id: 'hp', name: '生命' }],
    slots: [{ id: 'mainhand', name: '主手' }]
  })
  assert.deepEqual(state.data.characters[0].baseStats, { hp: 0 })
})

test('作品可配置装备与技能的成长位阶分界', () => {
  const db = fixture()
  const tierRules = { growthLevel: 6, eliteLevel: 16, masterLevel: 31, legendaryLevel: 51 }
  const state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true, tierRules })
  assert.deepEqual(state.data.tierRules, tierRules)
  assert.throws(() => applyGameCommand(db, 'p', state.revision, {
    kind: 'configure', tierRules: { growthLevel: 10, eliteLevel: 10, masterLevel: 30, legendaryLevel: 50 }
  }), /严格递增/)
})

test('人物已有章节记录后不能再改写初始档案', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: emptyGameCharacter('hero', state.data) })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'level-up', levels: 1 } })
  const changed = structuredClone(state.data.characters[0])
  changed.level = 99
  assert.throws(() => applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: changed }), /不能再改写初始档案/)
})

test('旧三槽作品无损转成十六格，旧装备和章节卸下记录仍可回放', () => {
  const db = fixture()
  const old = {
    version: 1, enabled: true, pointsPerLevel: 5,
    stats: [{ id: 'attack', name: '攻击' }],
    slots: [{ id: 'weapon', name: '武器' }, { id: 'armor', name: '护甲' }, { id: 'accessory', name: '饰品' }],
    assets: [{ id: 'blade', kind: 'equipment', name: '铁剑', aliases: [], description: '', rarity: '', tags: [], slotId: 'weapon', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 7 }, source: 'manual' }],
    characters: [{ characterId: 'hero', level: 1, experience: 0, freePoints: 0, baseStats: { attack: 0 }, allocatedStats: {}, owned: { blade: 1 }, equipped: { weapon: 'blade' }, activeTitleId: '', activeSpecialIds: [] }],
    events: [{ id: 'e1', characterId: 'hero', chapterId: 'c1', chapterIndex: 0, order: 1, status: 'committed', operation: { kind: 'unequip', slotId: 'weapon' }, source: 'manual', createdAt: '' }]
  }
  db.prepare('INSERT INTO game_progression (project_id, revision, data_json) VALUES (?, ?, ?)').run('p', 1, JSON.stringify(old))
  assert.deepEqual(readGameProject(db, 'p').data.tierRules, { growthLevel: 11, eliteLevel: 26, masterLevel: 51, legendaryLevel: 81 })
  const data = readGameProject(db, 'p').data
  assert.equal(data.slots.filter((slot) => !['twohand', 'ring', 'accessory'].includes(slot.id)).length, 16)
  assert.equal(data.assets[0].slotId, 'mainhand')
  assert.equal(data.characters[0].equipped.mainhand, 'blade')
  assert.equal(data.events[0].operation.slotId, 'mainhand')
  assert.equal(gameSnapshot(data, 'hero', 0).totals.attack, 0)
})

test('主角可指定，槽位可单独关闭但不能关闭仍在使用的槽位', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'configure', enabled: true })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-protagonist', characterId: 'hero' })
  assert.equal(state.data.protagonistCharacterId, 'hero')
  state = applyGameCommand(db, 'p', state.revision, { kind: 'upsert-asset', asset: {
    id: 'blade', kind: 'equipment', name: '铁剑', aliases: [], description: '', rarity: '', tags: [],
    slotId: 'mainhand', activation: 'equipped', levelRequirement: 1, bonuses: { attack: 7 }, source: 'manual'
  } })
  const hero = emptyGameCharacter('hero', state.data)
  hero.owned.blade = 1
  hero.equipped.mainhand = 'blade'
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-character', character: hero })
  assert.throws(() => applyGameCommand(db, 'p', state.revision, { kind: 'set-slot-enabled', slotId: 'mainhand', enabled: false }), /最新章节仍有已穿戴装备/)
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c2', operation: { kind: 'unequip', slotId: 'mainhand' } })
  state = applyGameCommand(db, 'p', state.revision, { kind: 'set-slot-enabled', slotId: 'mainhand', enabled: false })
  assert.equal(state.data.slots.find((slot) => slot.id === 'mainhand').enabled, false)
  assert.throws(() => applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c2', operation: { kind: 'equip', assetId: 'blade' } }), /已在本作品关闭/)
})

test('一键测试数据生成装备和技能且不会覆盖已有目录', () => {
  const db = fixture()
  let state = applyGameCommand(db, 'p', 0, { kind: 'generate-test-data', characterId: 'hero' })
  assert.equal(state.data.enabled, true)
  assert.equal(state.data.protagonistCharacterId, 'hero')
  assert.equal(state.data.assets.filter((asset) => asset.kind === 'skill').length, 3)
  assert.deepEqual(state.data.characters[0].learnedSkillIds, ['demo-fireball', 'demo-wind-step'])
  const snapshot = gameSnapshot(state.data, 'hero', 0, 'c1')
  assert.equal(snapshot.level, 8)
  assert.equal(snapshot.freePoints, 10)
  assert.equal(Object.keys(snapshot.equipped).length, 4)
  state = applyGameCommand(db, 'p', state.revision, { kind: 'stage', characterId: 'hero', chapterId: 'c1', operation: { kind: 'learn-skill', assetId: 'demo-insight' } })
  assert.equal(gameSnapshot(state.data, 'hero', 0, 'c1').learnedSkillIds.length, 3)
  assert.throws(() => applyGameCommand(db, 'p', state.revision, { kind: 'generate-test-data', characterId: 'hero' }), /不能生成测试数据/)
})

test('规则版本从未来章生效，旧章保持原值并拒绝覆盖历史规则', () => {
  const db = fixture()
  let state = applyGameCommand(db,'p',0,{kind:'configure',enabled:true})
  const hero=emptyGameCharacter('hero',state.data);hero.baseStats.agility=1
  state=applyGameCommand(db,'p',state.revision,{kind:'set-character',character:hero})
  const old=gameSnapshot(state.data,'hero',0,'c1')
  const command={kind:'version-rules',chapterId:'c2',derivedRules:{...state.data.derivedRules,dodgePerAgility:0.7},flatPrecision:0,percentPrecision:2,combatRules:{...state.data.combatRules,enabled:true}}
  state=applyGameCommand(db,'p',state.revision,command)
  assert.deepEqual(gameSnapshot(state.data,'hero',0,'c1'),old)
  assert.equal(gameSnapshot(state.data,'hero',1,'c2').totals.dodge,0.7)
  assert.match(buildGameWritingContext(db,'p','c2'),/战斗规则/)
  assert.match(buildGameWritingContext(db,'p','c2'),/0.7/)
  assert.throws(()=>applyGameCommand(db,'p',state.revision,command),/之后/)
  assert.throws(()=>applyGameCommand(db,'p',state.revision,{kind:'configure',stats:state.data.stats}),/规则版本/)
  assert.equal(validateImportedGameProject(db,'p',structuredClone(state.data)).ruleVersions.length,1)
  db.exec("DELETE FROM chapters WHERE id='c2'")
  assert.equal(validateImportedGameProject(db,'p',structuredClone(state.data)).ruleVersions[0].chapterIndex,1)
  db.close()
})
test('战斗扣血由后端重算，旧 revision 与已定稿章节不能写入', () => {
  const db=fixture();db.exec("INSERT INTO characters VALUES ('enemy','p','怪物')")
  let state=applyGameCommand(db,'p',0,{kind:'configure',enabled:true})
  for(const id of ['hero','enemy']) {
    const character=emptyGameCharacter(id,state.data);character.baseStats={health:200,attack:100,defense:100}
    state=applyGameCommand(db,'p',state.revision,{kind:'set-character',character})
  }
  state=applyGameCommand(db,'p',state.revision,{kind:'version-rules',chapterId:'c1',derivedRules:state.data.derivedRules,flatPrecision:0,percentPrecision:2,combatRules:{...state.data.combatRules,enabled:true}})
  const command={kind:'combat',chapterId:'c1',attackerId:'hero',defenderId:'enemy',input:{damageType:'physical',power:1,flat:0,hitRoll:0,criticalRoll:99}}
  const oldRevision=state.revision
  state=applyGameCommand(db,'p',state.revision,command)
  assert.equal(gameSnapshot(state.data,'enemy',0,'c1').currentResources.health,150)
  assert.equal(state.data.events.at(-1).operation.amount,50)
  assert.throws(()=>applyGameCommand(db,'p',oldRevision,command),/其他窗口/)
  db.exec("UPDATE chapters SET status='final' WHERE id='c1'")
  assert.throws(()=>applyGameCommand(db,'p',state.revision,command),/定稿/)
  db.close()
})
