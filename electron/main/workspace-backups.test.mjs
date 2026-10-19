import { copyBackupChapters, copyBackupProjectChapters } from '../shared/backup-preview.ts'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  applyPendingWorkspaceRestore,
  createWorkspaceBackup,
  listWorkspaceBackups,
  stageWorkspaceRestore, previewWorkspaceBackup, readBackupChapters
} from './workspace-backups.ts'

test('complete SQLite backup can be previewed and restored after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mo-mai-backup-'))
  const dbPath = join(directory, 'workspace.db')
  const db = new DatabaseSync(dbPath)
  try {
    db.exec('CREATE TABLE projects (title TEXT NOT NULL)')
    db.prepare('INSERT INTO projects (title) VALUES (?)').run('备份时的作品')
    const backup = await createWorkspaceBackup(db, directory, true)
    assert.ok(backup)
    assert.ok(Number.isFinite(new Date(backup.createdAt).getTime()))
    assert.deepEqual((await listWorkspaceBackups(directory))[0].projectTitles, ['备份时的作品'])
    db.prepare('UPDATE projects SET title = ?').run('恢复前的作品')
    await stageWorkspaceRestore(directory, backup.name)
  } finally {
    db.close()
  }
  try {
    assert.equal(await applyPendingWorkspaceRestore(directory), true)
    const restored = new DatabaseSync(dbPath, { readOnly: true })
    try {
      assert.equal(restored.prepare('SELECT title FROM projects').get().title, '备份时的作品')
    } finally {
      restored.close()
    }
    const rollback = (await listWorkspaceBackups(directory)).find((item) => item.projectTitles.includes('恢复前的作品'))
    assert.ok(rollback)
    assert.ok((await readFile(join(directory, 'backups', rollback.name, 'workspace.db'))).length > 0)
    assert.equal(await applyPendingWorkspaceRestore(directory), false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('rolling retention keeps seven backups and protects the chosen restore point', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mo-mai-backup-'))
  const db = new DatabaseSync(join(directory, 'workspace.db'))
  try {
    db.exec('CREATE TABLE projects (title TEXT NOT NULL)')
    db.prepare('INSERT INTO projects (title) VALUES (?)').run('测试')
    const chosen = await createWorkspaceBackup(db, directory, true)
    assert.ok(chosen)
    for (let index = 0; index < 9; index++) {
      await createWorkspaceBackup(db, directory, true, chosen.name)
    }
    const backups = await listWorkspaceBackups(directory)
    assert.equal(backups.length, 7)
    assert.ok(backups.some((item) => item.name === chosen.name))
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('restoring a complete backup restores reference text, covers, and imported skills', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'mo-mai-complete-backup-'))
  const directory = join(userData, 'data')
  await mkdir(directory)
  const files = [
    join(directory, 'reference-novels', 'book.txt'),
    join(directory, 'project-covers', 'cover.png'),
    join(userData, 'project-skills', '_shared', 'my-skill', 'SKILL.md')
  ]
  for (const path of files) {
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, '备份时的文件')
  }
  const db = new DatabaseSync(join(directory, 'workspace.db'))
  try {
    db.exec('CREATE TABLE projects (title TEXT NOT NULL)')
    db.prepare('INSERT INTO projects (title) VALUES (?)').run('作品')
    const saved = await createWorkspaceBackup(db, directory, true)
    assert.ok(saved)
    assert.equal(saved.assetMode, 'complete')
    for (const path of files) await writeFile(path, '恢复前的文件')
    await stageWorkspaceRestore(directory, saved.name)
  } finally {
    db.close()
  }
  try {
    await applyPendingWorkspaceRestore(directory)
    for (const path of files) assert.equal(await readFile(path, 'utf8'), '备份时的文件')
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('old database-only backups remain selectable and do not replace current asset folders', async () => {
  const userData = await mkdtemp(join(tmpdir(), 'mo-mai-legacy-backup-'))
  const directory = join(userData, 'data')
  await mkdir(join(directory, 'reference-novels'), { recursive: true })
  const referencePath = join(directory, 'reference-novels', 'book.txt')
  await writeFile(referencePath, '当前参考原文')
  const db = new DatabaseSync(join(directory, 'workspace.db'))
  try {
    db.exec('CREATE TABLE projects (title TEXT NOT NULL)')
    db.prepare('INSERT INTO projects (title) VALUES (?)').run('旧备份作品')
    const complete = await createWorkspaceBackup(db, directory, true)
    assert.ok(complete)
    const legacyName = complete.name.replace(/\.backup$/, '.db')
    await copyFile(join(directory, 'backups', complete.name, 'workspace.db'), join(directory, 'backups', legacyName))
    assert.equal((await listWorkspaceBackups(directory)).find((item) => item.name === legacyName)?.assetMode, 'database-only')
    db.prepare('UPDATE projects SET title = ?').run('现在的作品')
    await stageWorkspaceRestore(directory, legacyName)
  } finally {
    db.close()
  }
  try {
    await applyPendingWorkspaceRestore(directory)
    assert.equal(await readFile(referencePath, 'utf8'), '当前参考原文')
  } finally {
    await rm(userData, { recursive: true, force: true })
  }
})

test('备份目录预览与按章读取只读隔离，复制正文历史时生成新身份', async()=>{
  const directory=await mkdtemp(join(tmpdir(),'mo-mai-select-backup-'))
  const db=new DatabaseSync(join(directory,'workspace.db'))
  try {
    db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,title TEXT);INSERT INTO projects VALUES('p','备份作品');
      CREATE TABLE outline_volumes(id TEXT,project_id TEXT,title TEXT);INSERT INTO outline_volumes VALUES('v','p','第一卷');
      CREATE TABLE chapters(id TEXT,project_id TEXT,volume_id TEXT,title TEXT,summary TEXT,status TEXT,word_target TEXT,content TEXT,sort_order INTEGER);
      INSERT INTO chapters VALUES('c','p','v','旧章节','摘要','final','2000','<p>原正文</p>',0);
      CREATE TABLE chapter_versions(id TEXT,project_id TEXT,chapter_id TEXT,title TEXT,summary TEXT,status TEXT,word_target TEXT,content TEXT,created_at TEXT);
      INSERT INTO chapter_versions VALUES('h','p','c','旧标题','','draft','2000','历史正文','2026-01-01');`)
    const saved=await createWorkspaceBackup(db,directory,true)
    db.exec("UPDATE chapters SET content='新的正文'")
    const catalog=await previewWorkspaceBackup(directory,saved.name)
    assert.equal(catalog.projects[0].chapters[0].volumeTitle,'第一卷')
    const preview=await readBackupChapters(directory,saved.name,'p',['c'],false)
    assert.equal(preview.chapters[0].content,'<p>原正文</p>')
    assert.deepEqual(preview.versions,[])
    const selected=await readBackupChapters(directory,saved.name,'p',['c'])
    assert.equal(selected.chapters[0].content,'<p>原正文</p>');assert.equal(selected.versions[0].content,'历史正文')
    let id=0;const copied=copyBackupChapters(selected,'target',()=>`new-${++id}`)
    assert.equal(copied.chapters[0].status,'draft');assert.equal(copied.chapters[0].volumeId,'target');assert.equal(copied.chapterVersions[0].chapterId,copied.chapters[0].id)
    assert.notEqual(copied.chapters[0].id,'c');assert.equal(selected.chapters[0].status,'final')
    assert.equal(db.prepare('SELECT content FROM chapters').get().content,'新的正文')
    await assert.rejects(readBackupChapters(directory,saved.name,'wrong',['c']),/不存在/)
    await assert.rejects(previewWorkspaceBackup(directory,'../workspace.db'),/找不到/)
    await assert.rejects(readBackupChapters(directory,saved.name,'p',[]),/请选择/)
  } finally {db.close();await rm(directory,{recursive:true,force:true})}
})

test('恢复新作品保留选中章节的原分卷顺序、名称和卷信息，历史版本重新关联',()=>{
  const selection={volumes:[{id:'v2',title:'第二卷',wordTarget:'50000',summary:'卷二目标'},{id:'v1',title:'第一卷',wordTarget:'30000',summary:'卷一目标'},{id:'empty',title:'未选卷',wordTarget:'',summary:''}],chapters:[{id:'c1',volumeId:'v1',title:'甲',status:'final',content:'正文甲'},{id:'c2',volumeId:'v2',title:'乙',status:'review',content:'正文乙'}],versions:[{id:'h1',chapterId:'c1',content:'旧稿'}]}
  let seq=0;const restored=copyBackupProjectChapters(selection,()=>`id-${++seq}`)
  assert.deepEqual(restored.outlineVolumes.map(v=>v.title),['第二卷','第一卷'])
  assert.equal(restored.outlineVolumes[0].summary,'卷二目标')
  assert.deepEqual(restored.chapters.map(c=>c.content),['正文乙','正文甲'])
  assert.equal(restored.chapters[0].volumeId,restored.outlineVolumes[0].id)
  assert.equal(restored.chapterVersions[0].chapterId,restored.chapters[1].id)
  assert.equal(restored.chapters[1].status,'draft')
  assert.equal(selection.chapters[0].id,'c1')
})
