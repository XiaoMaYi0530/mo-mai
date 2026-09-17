import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveSkillContentIdentityFromText } from './registry-merge.ts'

export type SkillImportDuplicate = {
  sourceSkillId: string
  existingSkillId: string
}

export type SkillImportResult = {
  importedSkillIds: string[]
  updatedSkillIds: string[]
  skippedDuplicates: SkillImportDuplicate[]
}

export async function findImportableSkillDirectories(root: string): Promise<string[]> {
  if (existsSync(join(root, 'SKILL.md'))) return [root]
  if (!existsSync(root)) return []
  const nestedRoot = join(root, 'skills')
  const searchRoot = existsSync(nestedRoot) ? nestedRoot : root
  const entries = await readdir(searchRoot, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && existsSync(join(searchRoot, entry.name, 'SKILL.md')))
    .map((entry) => join(searchRoot, entry.name))
}

async function listTargetSkills(targetRoot: string): Promise<Array<{ id: string; identity: string }>> {
  if (!existsSync(targetRoot)) return []
  const entries = await readdir(targetRoot, { withFileTypes: true })
  const result: Array<{ id: string; identity: string }> = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.skill-import-')) continue
    const file = join(targetRoot, entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    result.push({
      id: entry.name,
      identity: resolveSkillContentIdentityFromText(await readFile(file, 'utf8'))
    })
  }
  return result
}

async function installDirectoryAtomically(sourceDir: string, targetRoot: string, skillId: string): Promise<'imported' | 'updated'> {
  const targetDir = join(targetRoot, skillId)
  const nonce = randomUUID()
  const tempDir = join(targetRoot, `.skill-import-${nonce}`)
  const backupDir = join(targetRoot, `.skill-import-backup-${nonce}`)
  const updating = existsSync(targetDir)
  let movedOld = false

  try {
    await cp(sourceDir, tempDir, { recursive: true, force: false, errorOnExist: true })
    if (!existsSync(join(tempDir, 'SKILL.md'))) throw new Error(`Skill ${skillId} 缺少 SKILL.md`)
    if (updating) {
      await rename(targetDir, backupDir)
      movedOld = true
    }
    await rename(tempDir, targetDir)
    if (movedOld) await rm(backupDir, { recursive: true, force: true })
    return updating ? 'updated' : 'imported'
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    if (movedOld && !existsSync(targetDir) && existsSync(backupDir)) {
      await rename(backupDir, targetDir).catch(() => {})
    }
    throw error
  }
}

/**
 * 导入 Skill：同内容不重复写入；同 ID 不同内容使用可回滚的目录替换进行版本更新。
 */
export async function importSkillDirectories(
  sourceDirs: string[],
  targetRoot: string
): Promise<SkillImportResult> {
  await mkdir(targetRoot, { recursive: true })
  const existing = await listTargetSkills(targetRoot)
  const byId = new Map(existing.map((item) => [item.id, item]))
  const byIdentity = new Map(existing.map((item) => [item.identity, item]))
  const result: SkillImportResult = { importedSkillIds: [], updatedSkillIds: [], skippedDuplicates: [] }

  for (const sourceDir of sourceDirs) {
    const skillId = basename(sourceDir)
    if (!skillId || skillId === '.' || skillId === '..') throw new Error('Skill 目录名无效。')
    const sourceFile = join(sourceDir, 'SKILL.md')
    const identity = resolveSkillContentIdentityFromText(await readFile(sourceFile, 'utf8'))
    const sameContent = byIdentity.get(identity)
    if (sameContent) {
      result.skippedDuplicates.push({ sourceSkillId: skillId, existingSkillId: sameContent.id })
      continue
    }

    const action = await installDirectoryAtomically(sourceDir, targetRoot, skillId)
    if (action === 'updated') result.updatedSkillIds.push(skillId)
    else result.importedSkillIds.push(skillId)

    const old = byId.get(skillId)
    if (old) byIdentity.delete(old.identity)
    const current = { id: skillId, identity }
    byId.set(skillId, current)
    byIdentity.set(identity, current)
  }

  result.importedSkillIds.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  result.updatedSkillIds.sort((a, b) => a.localeCompare(b, 'zh-CN'))
  return result
}
