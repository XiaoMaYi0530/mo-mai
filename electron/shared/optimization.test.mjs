import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyGameProject, emptyGameCharacter, gameSnapshot } from './game-progression.ts'
import { DEFAULT_COMBAT_RULES, resolveCombat } from './game-combat.ts'
import { decodeReadReceipt, encodeReadReceipt, summarizeReadReceipts } from './project-read-receipt.ts'
import { characterReadBatches } from '../main/ai/agent/tools/project-read-tracking.ts'
import { requestsFullCharacterReview, reviewAllCharacters } from '../main/ai/runtime-v2/character-review.ts'
import { creationDraftKey, readCreationDraft, writeCreationDraft } from '../../renderer/src/features/wizard/localCreationDraft.ts'
import { transferOutlineNodes, undoOutlineTransfer } from '../../renderer/src/features/workspace/outlineTransfer.ts'
import { resolveAssistantWidth } from '../../renderer/src/features/chapters/chapterPanelLayout.ts'

function game() {
  const data = emptyGameProject()
  const hero = emptyGameCharacter('hero', data)
  hero.baseStats = { agility: 1, attack: 100, health: 200, speed: 1000, critical: 1000 }
  const enemy = emptyGameCharacter('enemy', data)
  enemy.baseStats = { health: 200, defense: 100, dodge: 1000 }
  data.characters = [hero, enemy]
  return data
}
test('百分比保留小数，旧数据仍按旧规则回放，新版只影响生效章以后', () => {
  const data = game()
  assert.equal(gameSnapshot(data, 'hero', 0).totals.dodge, 0.2)
  delete data.percentPrecision; delete data.flatPrecision
  assert.equal(gameSnapshot(data, 'hero', 0).totals.dodge, 0)
  const old = gameSnapshot(data, 'hero', 0)
  data.ruleVersions = [{ id:'v1',effectiveChapterId:'c2',chapterIndex:1,derivedRules:{...data.derivedRules,dodgePerAgility:0.3},flatPrecision:0,percentPrecision:2,combatRules:DEFAULT_COMBAT_RULES }]
  assert.deepEqual(gameSnapshot(data, 'hero', 0), old)
  assert.equal(gameSnapshot(data, 'hero', 1).totals.dodge, 0.3)
})
test('战斗概率封顶、临界判定、减伤与速度限制使用同一公式', () => {
  const data = game(), a = gameSnapshot(data,'hero',0), d = gameSnapshot(data,'enemy',0)
  const rules={...DEFAULT_COMBAT_RULES,enabled:true}
  const input={damageType:'physical',power:1,flat:0,hitRoll:19,criticalRoll:74}
  const hit=resolveCombat(a,d,rules,input)
  assert.equal(hit.hitChance,20); assert.equal(hit.criticalChance,75)
  assert.equal(hit.damage,75); assert.equal(hit.healthAfter,125); assert.equal(hit.attackerActionsPerSecond,5)
  assert.equal(resolveCombat(a,d,rules,{...input,hitRoll:20}).damage,0)
  assert.equal(resolveCombat(a,d,rules,{...input,criticalRoll:75}).damage,50)
  assert.throws(()=>resolveCombat(a,d,rules,{...input,hitRoll:100}), /无效/)
  assert.throws(()=>resolveCombat(a,d,DEFAULT_COMBAT_RULES,input), /启用/)
})
test('长人物卡分批覆盖无遗漏，摘要不冒充完整阅读', async () => {
  const batches=characterReadBatches([{id:'a',name:'甲',role:'主角',description:'长'.repeat(25001)},{id:'b',name:'乙',role:'',description:'短卡'}])
  assert.equal(batches.length,2)
  const calls=[], reviewed=[]
  const report=await reviewAllCharacters({ctx:{projectId:'p',signal:new AbortController().signal},
    tool:{handler:async args=>{calls.push(args.scan_cursor);const b=batches[args.scan_cursor];return {content:encodeReadReceipt(b.receipt,b.body)}}},
    onRead:()=>{},onProgress:()=>{},review:async body=>{reviewed.push(body);return '核对完成'} })
  assert.deepEqual(calls,[0,1]); assert.match(report,/甲/); assert.equal(reviewed.join('').split('长').length-1,25001)
  const summary=summarizeReadReceipts(batches.map(b=>b.receipt))[0]
  assert.equal(summary.full,2);assert.equal(summary.remaining,0)
  const incomplete=summarizeReadReceipts([batches[0].receipt])[0]
  assert.equal(incomplete.full,0); assert.equal(incomplete.items.find(i=>i.id==='b').mode,'unread')
  const gap={module:'characters',total:1,items:[{id:'x',title:'x',mode:'partial',from:5,to:10,total:10}]}
  assert.equal(summarizeReadReceipts([gap])[0].full,0)
  assert.equal(summarizeReadReceipts([{...gap,items:[{...gap.items[0],mode:'summary',from:0}]}])[0].full,0)
  assert.equal(decodeReadReceipt('MO_MAI_READ_RECEIPT invalid').receipt,undefined)
})
test('完整审查正确触发，拒绝否定请求，取消和重复游标及时停止', async () => {
  assert.equal(requestsFullCharacterReview('请检查全部人物卡，按批次读完'),true)
  assert.equal(requestsFullCharacterReview('不要检查全部人物，只看主角'),false)
  assert.equal(requestsFullCharacterReview('帮我写下一章'),false)
  const batch=characterReadBatches([{id:'a',name:'a',role:'',description:'a'}])[0]
  batch.receipt.nextCursor=0
  const deps={ctx:{projectId:'p',signal:new AbortController().signal},tool:{handler:async()=>({content:encodeReadReceipt(batch.receipt,batch.body)})},onRead:()=>{},onProgress:()=>{},review:async()=>'ok'}
  await assert.rejects(reviewAllCharacters(deps),/重复/)
  const abort=new AbortController();abort.abort()
  await assert.rejects(reviewAllCharacters({...deps,ctx:{...deps.ctx,signal:abort.signal}}),/abort/i)
  await assert.rejects(reviewAllCharacters({...deps,review:async()=>''}),/未返回/)
})
test('草稿隔离与失败保存保留最后一次成功内容', () => {
  const map=new Map(), storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}
  const key=creationDraftKey('p','r'), data={form:{title:'草稿'},referencePlan:{auxiliaries:[]},revisionProposal:{edits:['待采纳']}}
  writeCreationDraft(storage,key,data)
  assert.deepEqual(readCreationDraft(storage,key).data,data)
  assert.equal(readCreationDraft(storage,creationDraftKey('p2','r')),null)
  assert.throws(()=>writeCreationDraft({...storage,setItem:()=>{throw Error('quota')}},key,{...data,form:{title:'new'}}),/quota/)
  assert.equal(readCreationDraft(storage,key).data.form.title,'草稿')
  map.set(key,'broken');assert.equal(readCreationDraft(storage,key),null)
})
test('大纲联动移动保持顺序，撤销只恢复位置并保留新正文，拒绝覆盖后续结构修改', () => {
  const ws={outlineVolumes:[{id:'v1'},{id:'v2'},{id:'v3'}],outlineItems:[{id:'a',volumeId:'v1'},{id:'b',volumeId:'v1'},{id:'c',volumeId:'v2'}],chapters:[{id:'a1',outlineItemId:'a',volumeId:'v1',content:'old'},{id:'b1',outlineItemId:'b',volumeId:'v1'},{id:'c1',outlineItemId:'c',volumeId:'v2'},{id:'d1',volumeId:'v3'}]}
  const moved=transferOutlineNodes(ws,['b','a'],'v2',true)
  assert.deepEqual(moved.workspace.outlineItems.map(i=>i.id),['c','a','b'])
  assert.deepEqual(moved.workspace.chapters.map(i=>i.id),['c1','a1','b1','d1'])
  moved.workspace.chapters.find(i=>i.id==='a1').content='new'
  const undone=undoOutlineTransfer(moved.workspace,moved.undo)
  assert.deepEqual(undone.chapters.map(i=>i.id),ws.chapters.map(i=>i.id))
  assert.equal(undone.chapters[0].content,'new');assert.equal(undone.chapters[0].volumeId,'v1')
  assert.equal(transferOutlineNodes(ws,['a'],'v2',false).chapterCount,0)
  assert.equal(undoOutlineTransfer({...moved.workspace,chapters:[...moved.workspace.chapters,{id:'new',volumeId:'v2'}]},moved.undo),null)
  assert.throws(()=>transferOutlineNodes(ws,['a'],'missing',true),/不存在/)
})
test('1440 窗口侧栏可拉宽，同时留出编辑区', () => {
  assert.equal(resolveAssistantWidth(560,1440,true),560)
  assert.equal(resolveAssistantWidth(1000,1440,true),736)
  assert.equal(resolveAssistantWidth(560,1000,true),296)
})
