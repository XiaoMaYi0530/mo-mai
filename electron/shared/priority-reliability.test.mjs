import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { restoreTrashedChapter } from './chapter-trash.ts'
import { normalizeReferenceUsage,formatReferenceUsage } from './reference-usage.ts'
import { initChapterTrashSchema,readChapterTrash,writeChapterTrash,archiveChapterBeforeDelete } from '../main/chapter-trash-store.ts'

test('回收站恢复空卷顺序、正文和历史，关联已删除时回退，重复恢复被拒绝',()=>{
  const entry={chapter:{id:'a',volumeId:'v1',outlineItemId:'deleted',content:'正文'},versions:[{id:'history',content:'旧正文'}],originalIndex:3}
  const result=restoreTrashedChapter([{id:'b',volumeId:'v2',outlineItemId:''}],[],entry,['v1','v2'],[])
  assert.deepEqual(result.chapters.map(c=>c.id),['a','b']);assert.equal(result.chapters[0].content,'正文');assert.equal(result.chapters[0].outlineItemId,'')
  assert.equal(result.versions[0].content,'旧正文')
  assert.throws(()=>restoreTrashedChapter(result.chapters,[],entry,['v1','v2'],[]),/重复/)
  assert.equal(restoreTrashedChapter([],[],entry,['new'],[]).chapters[0].volumeId,'new')
})
test('AI 删除前保存章节和历史，与删除共用事务；旧客户端省略回收站不会清空',()=>{
  const db=new DatabaseSync(':memory:')
  db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE projects(id TEXT PRIMARY KEY);INSERT INTO projects VALUES('p');
    CREATE TABLE chapters(id TEXT PRIMARY KEY,project_id TEXT,volume_id TEXT,outline_item_id TEXT,title TEXT,summary TEXT,status TEXT,word_target TEXT,content TEXT,sort_order INTEGER);
    CREATE TABLE chapter_versions(id TEXT,project_id TEXT,chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,title TEXT,summary TEXT,status TEXT,word_target TEXT,content TEXT,created_at TEXT);
    INSERT INTO chapters VALUES('a','p','v','','标题','','draft','2000','正文',0);
    INSERT INTO chapter_versions VALUES('h','p','a','旧标题','','draft','2000','旧正文','date');`)
  initChapterTrashSchema(db)
  db.exec('BEGIN');archiveChapterBeforeDelete(db,'p','a');db.exec("DELETE FROM chapters WHERE id='a';ROLLBACK")
  assert.deepEqual(readChapterTrash(db,'p'),[])
  db.exec('BEGIN');archiveChapterBeforeDelete(db,'p','a');db.exec("DELETE FROM chapters WHERE id='a';COMMIT")
  writeChapterTrash(db,'p',undefined)
  const [entry]=readChapterTrash(db,'p');assert.equal(entry.chapter.content,'正文');assert.equal(entry.versions[0].content,'旧正文')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM chapter_versions').get().n,0)
  db.close()
})
test('参考分工最多三本、去重，保留用途边界并独立于文风',()=>{
  const rows=normalizeReferenceUsage([{referenceWorkId:'a',purpose:'pacing',boundary:'不借结局'},{referenceWorkId:'a',purpose:'world'},{referenceWorkId:'b',purpose:'world'},{referenceWorkId:'c',purpose:'relationships'},{referenceWorkId:'d',purpose:'plot'}])
  assert.deepEqual(rows.map(r=>r.role),['main','auxiliary','auxiliary'])
  const text=formatReferenceUsage(rows,[{id:'a',title:'作品甲'},{id:'b',title:'作品乙'}])
  assert.match(text,/不借结局/);assert.match(text,/文风由独立绑定/);assert.match(text,/已缺失/)
})
