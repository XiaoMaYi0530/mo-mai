import { app } from 'electron'
import { existsSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { resolveSkillContentIdentityFromText } from './registry-merge'

export type DeletedSkillCopies = {
  deletedSkillIds: string[]
  deletedPaths: string[]
}

async function listImportedSkillDirectories(): Promise<string[]> {
  const root = join(app.getPath('userData'), 'project-skills')
  if (!existsSync(root)) return []
  const scopes = await readdir(root, { withFileTypes: true })
  const directories: string[] = []

  for (const scope of scopes) {
    if (!scope.isDirectory()) continue
    const scopeDir = join(root, scope.name)
    const entries = await readdir(scopeDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillDir = join(scopeDir, entry.name)
      if (existsSync(join(skillDir, 'SKILL.md'))) directories.push(skillDir)
    }
  }
  return directories
}

/**
 * 删除一个全局导入 Skill 以及所有内容相同的历史项目副本。
 * 内置 resources 不在 userData/project-skills 下，因此不会被触碰。
 */
export async function deleteImportedSkillAndCopies(skillId: string): Promise<DeletedSkillCopies> {
  const sharedDir = join(app.getPath('userData'), 'project-skills', '_shared', skillId)
  const sharedFile = join(sharedDir, 'SKILL.md')
  if (!existsSync(sharedFile)) throw new Error('只能删除用户导入的全局 Skill，内置 Skill 不会被删除。')

  const targetIdentity = resolveSkillContentIdentityFromText(await readFile(sharedFile, 'utf8'))
  const deletedPaths: string[] = []
  const deletedSkillIds: string[] = []
  for (const skillDir of await listImportedSkillDirectories()) {
    const skillFile = join(skillDir, 'SKILL.md')
    const identity = resolveSkillContentIdentityFromText(await readFile(skillFile, 'utf8'))
    if (skillDir !== sharedDir && identity !== targetIdentity) continue
    await rm(skillDir, { recursive: true, force: false })
    deletedPaths.push(skillDir)
    deletedSkillIds.push(basename(skillDir))
  }

  return {
    deletedSkillIds: [...new Set(deletedSkillIds)],
    deletedPaths
  }
}
