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
  stageWorkspaceRestore
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
