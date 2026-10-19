import { randomUUID } from 'node:crypto'
import { cp, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

const BACKUP_DIR = 'backups'
const RESTORE_MARKER = 'restore-pending.json'
const BACKUP_INTERVAL_MS = 12 * 60 * 60 * 1000
const MAX_BACKUPS = 7
const BACKUP_NAME = /^workspace-\d{8}T\d{6}-[a-f0-9]{8}\.(?:backup|db)$/
const ASSET_PATHS = [
  { live: (dir: string) => join(dir, 'reference-novels'), saved: 'reference-novels' },
  { live: (dir: string) => join(dir, 'project-covers'), saved: 'project-covers' },
  { live: (dir: string) => join(dirname(dir), 'project-skills'), saved: 'project-skills' }
] as const

export type WorkspaceBackupInfo = {
  name: string
  createdAt: string
  sizeBytes: number
  projectTitles: string[]
  assetMode: 'complete' | 'database-only'
}

let backupInFlight: Promise<WorkspaceBackupInfo | null> | null = null

function backupDir(workspaceDir: string): string {
  return join(workspaceDir, BACKUP_DIR)
}

function fileName(): string {
  return `workspace-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomUUID().slice(0, 8)}.backup`
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function copyTree(source: string, target: string): Promise<void> {
  if (!await exists(source)) return
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
    filter: async (path) => {
      const item = await lstat(path)
      return item.isDirectory() || item.isFile() // Never capture or restore symlinks.
    }
  })
}

async function copyAssets(workspaceDir: string, bundleDir: string): Promise<void> {
  for (const item of ASSET_PATHS) {
    await copyTree(item.live(workspaceDir), join(bundleDir, 'assets', item.saved))
  }
}

async function sizeOf(path: string): Promise<number> {
  const info = await lstat(path)
  if (info.isFile()) return info.size
  if (!info.isDirectory()) return 0
  const names = await readdir(path)
  return (await Promise.all(names.map((name) => sizeOf(join(path, name))))).reduce((sum, value) => sum + value, 0)
}

async function backupNames(workspaceDir: string): Promise<string[]> {
  const names = await readdir(backupDir(workspaceDir)).catch(() => [])
  const entries = await Promise.all(names.filter((name) => BACKUP_NAME.test(name)).map(async (name) => {
    const path = join(backupDir(workspaceDir), name)
    const info = await lstat(path)
    return { name, mtimeMs: info.mtimeMs, valid: name.endsWith('.backup') ? info.isDirectory() : info.isFile() }
  }))
  return entries.filter((entry) => entry.valid)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .map((entry) => entry.name)
}

async function inspectBackup(workspaceDir: string, name: string): Promise<WorkspaceBackupInfo> {
  const path = join(backupDir(workspaceDir), name)
  const complete = name.endsWith('.backup')
  if (complete) {
    const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')) as { version?: number }
    if (manifest.version !== 2) throw new Error('备份格式无效')
  }
  const db = new DatabaseSync(complete ? join(path, 'workspace.db') : path, { readOnly: true })
  try {
    const check = db.prepare('PRAGMA quick_check').get() as { quick_check: string }
    if (check.quick_check !== 'ok') throw new Error('备份数据库完整性校验失败')
    const rows = db.prepare('SELECT title FROM projects ORDER BY rowid LIMIT 20').all() as Array<{ title: string }>
    const compact = name.slice(10, 25)
    const createdAt = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`
    return {
      name, createdAt, sizeBytes: await sizeOf(path), projectTitles: rows.map((row) => row.title),
      assetMode: complete ? 'complete' : 'database-only'
    }
  } finally {
    db.close()
  }
}

export async function listWorkspaceBackups(workspaceDir: string): Promise<WorkspaceBackupInfo[]> {
  const results: WorkspaceBackupInfo[] = []
  for (const name of await backupNames(workspaceDir)) {
    try { results.push(await inspectBackup(workspaceDir, name)) } catch (error) {
      console.warn('[workspace-backup] ignored invalid backup:', name, error)
    }
  }
  return results
}

export async function createWorkspaceBackup(
  db: DatabaseSync, workspaceDir: string, force = false, protectedName = ''
): Promise<WorkspaceBackupInfo | null> {
  if (backupInFlight) {
    if (!force) return backupInFlight
    await backupInFlight
    return createWorkspaceBackup(db, workspaceDir, true, protectedName)
  }
  backupInFlight = (async () => {
    await mkdir(backupDir(workspaceDir), { recursive: true })
    const existing = await backupNames(workspaceDir)
    if (!force && existing[0]) {
      const age = Date.now() - (await stat(join(backupDir(workspaceDir), existing[0]))).mtimeMs
      if (age < BACKUP_INTERVAL_MS) return null
    }
    const name = fileName()
    const target = join(backupDir(workspaceDir), name)
    const temp = await mkdtemp(join(backupDir(workspaceDir), '.building-'))
    try {
      await backup(db, join(temp, 'workspace.db'))
      await copyAssets(workspaceDir, temp)
      await writeFile(join(temp, 'manifest.json'), JSON.stringify({ version: 2, createdAt: new Date().toISOString() }))
      await rename(temp, target)
      const result = await inspectBackup(workspaceDir, name)
      const disposable = (await backupNames(workspaceDir)).filter((item) => item !== protectedName && item !== name)
      for (const oldName of disposable.slice(MAX_BACKUPS - 1 - (protectedName ? 1 : 0))) {
        await rm(join(backupDir(workspaceDir), oldName), { recursive: true }).catch((error) => {
          console.warn('[workspace-backup] old backup cleanup failed:', oldName, error)
        })
      }
      return result
    } catch (error) {
      await rm(temp, { recursive: true, force: true }).catch(() => {})
      await rm(target, { recursive: true, force: true }).catch(() => {})
      throw error
    }
  })()
  try { return await backupInFlight } finally { backupInFlight = null }
}

export async function stageWorkspaceRestore(workspaceDir: string, name: string): Promise<void> {
  if (!BACKUP_NAME.test(name) || !(await backupNames(workspaceDir)).includes(name)) throw new Error('找不到所选本地备份')
  await inspectBackup(workspaceDir, name)
  const marker = join(workspaceDir, RESTORE_MARKER)
  const temp = `${marker}.${randomUUID()}.tmp`
  await writeFile(temp, JSON.stringify({ name }), { flag: 'wx' })
  await rename(temp, marker)
}

async function snapshotCurrentFiles(workspaceDir: string): Promise<void> {
  const temp = await mkdtemp(join(backupDir(workspaceDir), '.before-restore-'))
  try {
    const sourceDb = new DatabaseSync(join(workspaceDir, 'workspace.db'), { readOnly: true })
    try {
      await backup(sourceDb, join(temp, 'workspace.db'))
    } finally {
      sourceDb.close()
    }
    await copyAssets(workspaceDir, temp)
    await writeFile(join(temp, 'manifest.json'), JSON.stringify({ version: 2, createdAt: new Date().toISOString() }))
    await rename(temp, join(backupDir(workspaceDir), fileName()))
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}

/** Called before the workspace DB is opened on the next launch. */
export async function applyPendingWorkspaceRestore(workspaceDir: string): Promise<boolean> {
  const marker = join(workspaceDir, RESTORE_MARKER)
  let name: string
  try { name = (JSON.parse(await readFile(marker, 'utf8')) as { name: string }).name } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (!BACKUP_NAME.test(name)) throw new Error('恢复标记中的备份名无效')
  const sourceInfo = await inspectBackup(workspaceDir, name)
  await snapshotCurrentFiles(workspaceDir)

  const source = join(backupDir(workspaceDir), name)
  const staged = await mkdtemp(join(workspaceDir, '.restoring-'))
  const moved: Array<{ live: string; previous: string; installed: boolean }> = []
  try {
    await copyFile(sourceInfo.assetMode === 'complete' ? join(source, 'workspace.db') : source, join(staged, 'workspace.db'))
    if (sourceInfo.assetMode === 'complete') {
      for (const item of ASSET_PATHS) await copyTree(join(source, 'assets', item.saved), join(staged, item.saved))
      for (const item of ASSET_PATHS) {
        const live = item.live(workspaceDir)
        const next = join(staged, item.saved)
        const previous = `${live}.pre-restore-${randomUUID()}`
        if (await exists(live)) await rename(live, previous)
        const move = { live, previous, installed: false }
        moved.push(move)
        if (await exists(next)) { await rename(next, live); move.installed = true }
      }
    }
    const liveDb = join(workspaceDir, 'workspace.db')
    const previousDb = `${liveDb}.pre-restore-${randomUUID()}`
    if (await exists(liveDb)) await rename(liveDb, previousDb)
    const dbMove = { live: liveDb, previous: previousDb, installed: false }
    moved.push(dbMove)
    await rename(join(staged, 'workspace.db'), liveDb)
    dbMove.installed = true
    await unlink(marker)
    for (const move of moved) {
      try {
        if (await exists(move.previous)) await rm(move.previous, { recursive: true })
      } catch (error) {
        console.warn('[workspace-backup] restored file cleanup failed:', move.previous, error)
      }
    }
    return true
  } catch (error) {
    for (const move of moved.reverse()) {
      if (move.installed && await exists(move.live)) await rm(move.live, { recursive: true })
      if (await exists(move.previous)) await rename(move.previous, move.live)
    }
    await unlink(marker).catch(() => {})
    throw error
  } finally {
    await rm(staged, { recursive: true, force: true }).catch((error) => {
      console.warn('[workspace-backup] temporary restore cleanup failed:', staged, error)
    })
  }
}

async function openBackupForPreview(workspaceDir: string, name: string): Promise<DatabaseSync> {
  if (!BACKUP_NAME.test(name) || !(await backupNames(workspaceDir)).includes(name)) throw new Error('找不到所选本地备份')
  const path = name.endsWith('.backup') ? join(backupDir(workspaceDir), name, 'workspace.db') : join(backupDir(workspaceDir), name)
  if (!(await lstat(path)).isFile()) throw new Error('备份数据库不是普通文件')
  return new DatabaseSync(path, { readOnly: true })
}

export async function previewWorkspaceBackup(workspaceDir: string, name: string): Promise<import('../shared/backup-preview').BackupCatalog> {
  const db = await openBackupForPreview(workspaceDir, name)
  try {
    const projects = db.prepare('SELECT id, title FROM projects ORDER BY rowid').all() as Array<{ id: string; title: string }>
    const chapters = db.prepare(`SELECT c.project_id AS projectId,c.id,c.title,c.volume_id AS volumeId,
      COALESCE(v.title,'未分卷') AS volumeTitle,length(c.content) AS characters FROM chapters c
      LEFT JOIN outline_volumes v ON v.id=c.volume_id AND v.project_id=c.project_id ORDER BY c.sort_order,c.rowid`).all() as Array<import('../shared/backup-preview').BackupCatalog['projects'][number]['chapters'][number] & { projectId: string }>
    return { projects: projects.map(p => ({ ...p, chapters: chapters.filter(c => c.projectId === p.id).map(({ projectId: _, ...c }) => c) })) }
  } finally { db.close() }
}

export async function readBackupChapters(workspaceDir: string, name: string, projectId: string, chapterIds: string[], includeVersions = true): Promise<import('../shared/backup-preview').BackupChapterSelection> {
  if (!projectId || !Array.isArray(chapterIds) || !chapterIds.length || chapterIds.some(id => typeof id !== 'string' || !id)) throw new Error('请选择要恢复的章节')
  const db = await openBackupForPreview(workspaceDir, name)
  try {
    const wanted = new Set(chapterIds)
    const ids = db.prepare('SELECT id FROM chapters WHERE project_id=? ORDER BY sort_order,rowid').all(projectId).map(row => String(row.id)).filter(id => wanted.has(id))
    if (ids.length !== wanted.size) throw new Error('所选章节不存在于此备份作品中')
    const chapter = db.prepare('SELECT id,volume_id AS volumeId,title,summary,status,word_target AS wordTarget,content FROM chapters WHERE project_id=? AND id=?')
    const versions = includeVersions ? db.prepare('SELECT id,chapter_id AS chapterId,title,summary,status,word_target AS wordTarget,content,created_at AS createdAt FROM chapter_versions WHERE project_id=? AND chapter_id=? ORDER BY created_at DESC,rowid DESC') : null
    const columns = new Set(db.prepare('PRAGMA table_info(outline_volumes)').all().map(c => String(c.name)))
    const volumes = includeVersions ? db.prepare(`SELECT id,title,${columns.has('summary') ? 'summary' : "''"} AS summary,${columns.has('word_target') ? 'word_target' : "''"} AS wordTarget FROM outline_volumes WHERE project_id=? ORDER BY ${columns.has('sort_order') ? 'sort_order,' : ''}rowid`).all(projectId) : []
    return { chapters: ids.map(id => chapter.get(projectId,id)) as unknown as import('../shared/backup-preview').BackupChapter[],
      versions: versions ? ids.flatMap(id => versions.all(projectId,id)) as unknown as import('../shared/backup-preview').BackupChapterVersion[] : [],
      volumes: volumes as unknown as import('../shared/backup-preview').BackupVolume[] }
  } finally { db.close() }
}
