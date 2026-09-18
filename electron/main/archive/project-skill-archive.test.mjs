import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { collectProjectSkillsForArchive, restoreProjectSkillsFromArchive } from './project-skill-archive.ts'

test('项目归档携带自定义 Skill 正文与参考文件，恢复到新项目且不影响共享目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arc-skill-archive-'))
  const shared = join(root, 'project-skills', '_shared', 'custom-prose')
  await mkdir(join(shared, 'references'), { recursive: true })
  await writeFile(join(shared, 'SKILL.md'), '# 原创文风')
  await writeFile(join(shared, 'references', 'example.md'), '句段示例')
  const archive = await collectProjectSkillsForArchive(root, 'source', [
    { id: 'custom-prose', scope: 'project' },
    { id: '我吃西红柿笔锋', scope: 'project' }
  ])
  assert.equal(archive.length, 1)
  await restoreProjectSkillsFromArchive(root, 'target', archive)
  assert.equal(await readFile(join(root, 'project-skills', 'target', 'custom-prose', 'SKILL.md'), 'utf8'), '# 原创文风')
  assert.equal(await readFile(join(root, 'project-skills', 'target', 'custom-prose', 'references', 'example.md'), 'utf8'), '句段示例')
  assert.equal(await readFile(join(shared, 'SKILL.md'), 'utf8'), '# 原创文风')
})

test('归档 Skill 拒绝路径穿越且不触碰目标外文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arc-skill-archive-'))
  await assert.rejects(() => restoreProjectSkillsFromArchive(root, 'target', [{
    id: 'custom-prose',
    files: [
      { path: 'SKILL.md', base64: Buffer.from('# 正文').toString('base64') },
      { path: '../escape.md', base64: Buffer.from('危险').toString('base64') }
    ]
  }]), /非法或重复文件路径/)
})
