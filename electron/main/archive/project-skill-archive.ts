import { existsSync } from 'node:fs'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { PROMOTED_BUILTIN_SKILL_IDS } from '../ai/skills/promoted-builtins.ts'

export type ArchivedProjectSkill = {
  id: string
  files: Array<{ path: string; base64: string }>
}

function safeSegment(value: string): boolean {
  return Boolean(value) && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0')
}

function safeRelativePath(value: string): boolean {
  return Boolean(value) && value.split('/').every(safeSegment)
}

export function validateArchivedProjectSkills(value: unknown): asserts value is ArchivedProjectSkill[] {
  if (!Array.isArray(value)) throw new Error('归档 Skill 列表格式不正确')
  const ids = new Set<string>()
  for (const skill of value) {
    if (!skill || typeof skill !== 'object' || !safeSegment(skill.id) || ids.has(skill.id)) {
      throw new Error('归档 Skill ID 无效或重复')
    }
    ids.add(skill.id)
    if (!Array.isArray(skill.files) || !skill.files.some((file: { path?: unknown }) => file?.path === 'SKILL.md')) {
      throw new Error(`归档 Skill ${skill.id} 缺少 SKILL.md`)
    }
    const paths = new Set<string>()
    for (const file of skill.files) {
      if (!file || !safeRelativePath(file.path) || typeof file.base64 !== 'string' || paths.has(file.path)) {
        throw new Error(`归档 Skill ${skill.id} 包含非法或重复文件路径`)
      }
      paths.add(file.path)
    }
  }
}

async function readSkillFiles(root: string, relative = ''): Promise<ArchivedProjectSkill['files']> {
  const result: ArchivedProjectSkill['files'] = []
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    if (!safeSegment(entry.name) || entry.isSymbolicLink()) continue
    const next = relative ? `${relative}/${entry.name}` : entry.name
    if (entry.isDirectory()) result.push(...await readSkillFiles(root, next))
    else if (entry.isFile()) result.push({ path: next, base64: (await readFile(join(root, next))).toString('base64') })
  }
  return result
}

/** 仅打包项目实际引用的本机 Skill；正式内置的两个 Skill 由应用资源提供，不重复放进归档。 */
export async function collectProjectSkillsForArchive(
  userDataDir: string,
  projectId: string,
  skills: Array<{ id: string; scope?: string; path?: string }>
): Promise<ArchivedProjectSkill[]> {
  const archive: ArchivedProjectSkill[] = []
  const seen = new Set<string>()
  for (const skill of skills) {
    const id = String(skill.id ?? '').trim()
    if (!safeSegment(id) || seen.has(id) || PROMOTED_BUILTIN_SKILL_IDS.has(id) || skill.scope === 'builtin') continue
    seen.add(id)
    const projectDir = join(userDataDir, 'project-skills', projectId, id)
    const sharedDir = join(userDataDir, 'project-skills', '_shared', id)
    const root = existsSync(join(projectDir, 'SKILL.md')) ? projectDir : sharedDir
    if (!existsSync(join(root, 'SKILL.md'))) continue
    if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) continue
    const files = await readSkillFiles(root)
    if (files.some((file) => file.path === 'SKILL.md')) archive.push({ id, files })
  }
  return archive
}

/** 写入目标项目专属目录，避免恢复共享 Skill 时影响其他项目；单个 Skill 使用可回滚目录替换。 */
export async function restoreProjectSkillsFromArchive(
  userDataDir: string,
  projectId: string,
  archive: ArchivedProjectSkill[]
): Promise<void> {
  if (!safeSegment(projectId)) throw new Error('目标项目 ID 无效')
  validateArchivedProjectSkills(archive)
  const targetRoot = join(userDataDir, 'project-skills', projectId)
  await mkdir(targetRoot, { recursive: true })
  for (const skill of archive) {
    if (!safeSegment(skill.id) || PROMOTED_BUILTIN_SKILL_IDS.has(skill.id)) continue
    const staging = await mkdtemp(join(targetRoot, '.archive-skill-'))
    const target = join(targetRoot, skill.id)
    const backup = join(targetRoot, `.archive-skill-backup-${randomUUID()}`)
    let backedUp = false
    try {
      for (const file of skill.files) {
        if (!safeRelativePath(file.path) || typeof file.base64 !== 'string') {
          throw new Error(`归档 Skill ${skill.id} 包含非法文件路径`)
        }
        const destination = join(staging, ...file.path.split('/'))
        await mkdir(dirname(destination), { recursive: true })
        await writeFile(destination, Buffer.from(file.base64, 'base64'))
      }
      if (existsSync(target)) {
        if (!(await lstat(target)).isDirectory()) throw new Error(`Skill 目标不是目录：${skill.id}`)
        await rename(target, backup)
        backedUp = true
      }
      await rename(staging, target)
      if (backedUp) await rm(backup, { recursive: true })
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => {})
      if (backedUp && !existsSync(target)) await rename(backup, target).catch(() => {})
      throw error
    }
  }
}
