import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { Worker } from 'node:worker_threads'
import JSZip from 'jszip'

function runWorker(input) {
  const worker = new Worker(new URL('../../../dist-electron/main/archive/project-archive-import-worker.js', import.meta.url), { workerData: input })
  return new Promise((resolve, reject) => {
    let result
    worker.on('message', message => { if ('success' in message) result = message })
    worker.on('error', reject)
    worker.on('exit', code => code === 0 && result ? resolve(result) : reject(new Error('归档线程意外退出 ' + code)))
  })
}

test('正式归档线程覆盖项目时，附件写入失败会还原原稿和已替换的 Skill', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'momai-archive-worker-'))
  const workspaceDir = join(directory, 'data')
  const filePath = join(directory, 'sample.zip')
  try {
    await mkdir(workspaceDir)
    const zip = new JSZip()
    zip.file('manifest.json', JSON.stringify({ app: 'CharacterArc' }))
    zip.file('project.json', JSON.stringify({ id: 'source', title: '我的小说' }))
    zip.file('workspace/outline.json', JSON.stringify({ outlineVolumes: [{ id: 'volume', title: '第一卷', summary: '', wordTarget: '' }] }))
    function setContent(version) {
      zip.file('workspace/chapters.json', JSON.stringify([{ id: 'chapter', title: '第一章', content: version, volumeId: 'volume', outlineItemId: '', summary: '', status: 'draft', wordTarget: '' }]))
      zip.file('workspace/customSkills.json', JSON.stringify([{ id: 'writing', files: [{ path: 'SKILL.md', base64: Buffer.from(version).toString('base64') }] }]))
    }
    setContent('原稿')
    await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
    const modules = ['project', 'chapters', 'referenceNovelAssets']
    const first = await runWorker({ workspaceDir, filePath, mode: 'new-project', modules })
    assert.equal(first.success, true, first.error)
    const skillFile = join(directory, 'project-skills', first.selectedProjectId, 'writing', 'SKILL.md')
    assert.equal(await readFile(skillFile, 'utf8'), '原稿')
    setContent('新稿')
    zip.file('workspace/referenceWorks.json', JSON.stringify([{ id: 'book', title: '参考', source: 'import' }]))
    zip.file('assets/reference-novels/book.txt', '参考原文')
    await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
    const references = join(workspaceDir, 'reference-novels')
    await writeFile(references, '模拟附件目录不可用')
    const overwrite = { workspaceDir, filePath, mode: 'overwrite-project', targetProjectId: first.selectedProjectId, modules }
    assert.equal((await runWorker(overwrite)).success, false)
    const db = new DatabaseSync(join(workspaceDir, 'workspace.db'), { readOnly: true })
    try {
      assert.equal(db.prepare('SELECT content FROM chapters').get().content, '原稿')
      assert.equal(db.prepare('SELECT count(*) AS n FROM reference_works').get().n, 0)
      assert.equal(await readFile(skillFile, 'utf8'), '原稿')
      await rm(references)
      const retried = await runWorker(overwrite)
      assert.equal(retried.success, true, retried.error)
      assert.equal(db.prepare('SELECT content FROM chapters').get().content, '新稿')
      const id = db.prepare('SELECT id FROM reference_works').get().id
      assert.equal(await readFile(join(references, id + '.txt'), 'utf8'), '参考原文')
      assert.equal(await readFile(skillFile, 'utf8'), '新稿')
      setContent('不应写入的正文')
      zip.file('workspace/gameProgression.json', JSON.stringify({ version: 0, characters: [], events: [] }))
      await writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
      const invalid = await runWorker({ ...overwrite, modules: [...modules, 'gameProgression'] })
      assert.equal(invalid.success, false)
      assert.match(invalid.error, /数值数据格式无效/)
      assert.equal(db.prepare('SELECT content FROM chapters').get().content, '新稿')
      assert.equal(await readFile(skillFile, 'utf8'), '新稿')
    } finally { db.close() }
  } finally { await rm(directory, { recursive: true, force: true }) }
})
