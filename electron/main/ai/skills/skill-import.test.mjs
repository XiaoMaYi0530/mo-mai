import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { importSkillDirectories } from './skill-import.ts'

async function makeSkill(root, id, name, body) {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n# ${body}\n`, 'utf8')
  return dir
}

test('导入时跳过同内容副本，并对同 ID 新版本做安全更新', async () => {
  const root = await mkdtemp(join(tmpdir(), 'characterarc-skill-import-'))
  try {
    const sources = join(root, 'sources')
    const target = join(root, 'target')
    const first = await makeSkill(sources, 'natural-style', '自然文风', '规则 A')
    let result = await importSkillDirectories([first], target)
    assert.deepEqual(result.importedSkillIds, ['natural-style'])

    const duplicate = await makeSkill(sources, 'renamed-copy', '另一个显示名', '规则 A')
    result = await importSkillDirectories([duplicate], target)
    assert.deepEqual(result.skippedDuplicates, [{ sourceSkillId: 'renamed-copy', existingSkillId: 'natural-style' }])

    await writeFile(join(first, 'SKILL.md'), '---\nname: 自然文风\n---\n# 规则 B\n', 'utf8')
    result = await importSkillDirectories([first], target)
    assert.deepEqual(result.updatedSkillIds, ['natural-style'])
    assert.match(await readFile(join(target, 'natural-style', 'SKILL.md'), 'utf8'), /规则 B/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
