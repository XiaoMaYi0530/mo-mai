import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildCodexExecArgs, parseCodexJsonLine, resolveCodexCommand } from './codex-cli.ts'
import { buildCodexImagePrompt, generateImageViaCodexCli } from './codex-image.ts'
import { normalizeSettings, validateSettings } from './settings.ts'
import { getAiProviderCatalogEntry, shouldTryStreamingAgent } from '../../shared/ai-provider-catalog.ts'

const codexSettings = {
  provider: 'codex-cli',
  model: '',
  apiKey: '',
  baseUrl: '',
  codexCliPath: '',
  codexReasoningEffort: 'default',
  embeddingModel: '',
  imageModel: '',
  imageApiKey: '',
  imageBaseUrl: ''
}

test('Codex CLI 预设不要求 API 地址或 Key，并使用 default 模型', () => {
  const preset = getAiProviderCatalogEntry('codex-cli')
  const normalized = normalizeSettings(codexSettings)

  assert.equal(preset?.transport, 'codex-cli')
  assert.equal(preset?.supportsEmbedding, false)
  assert.equal(normalized.model, 'default')
  assert.equal(normalized.baseUrl, '')
  assert.doesNotThrow(() => validateSettings(normalized))
  assert.equal(shouldTryStreamingAgent('global-assistant', 'codex-cli', 'default'), false)
})

test('Codex exec 使用只读 JSONL 与 stdin，并传递模型和推理强度', () => {
  const args = buildCodexExecArgs({
    ...codexSettings,
    model: 'gpt-5.6-sol',
    codexReasoningEffort: 'high'
  }, { reasoningSummary: 'concise' })

  assert.deepEqual(args.slice(0, 6), [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '-c'
  ])
  assert.ok(args.includes('features.shell_tool=false'))
  assert.ok(args.includes('model_reasoning_effort="high"'))
  assert.ok(args.includes('model_reasoning_summary="concise"'))
  assert.deepEqual(args.slice(-3), ['--model', 'gpt-5.6-sol', '-'])
})

test('Codex exec 可按准确 session id 续接，避免使用全局 --last', () => {
  const args = buildCodexExecArgs({
    ...codexSettings,
    model: 'gpt-5.6-sol',
    codexReasoningEffort: 'medium'
  }, { resumeSessionId: '0199-session-id' })

  assert.deepEqual(args.slice(0, 2), ['exec', 'resume'])
  assert.ok(args.includes('--json'))
  assert.ok(args.includes('0199-session-id'))
  assert.ok(!args.includes('--last'))
  assert.ok(!args.includes('--sandbox'))
  assert.deepEqual(args.slice(-2), ['0199-session-id', '-'])
})

test('Codex CLI 路径拒绝混入 shell 环境变量', () => {
  assert.throws(
    () => resolveCodexCommand({
      ...codexSettings,
      codexCliPath: 'HTTPS_PROXY=http://127.0.0.1:7890 /opt/homebrew/bin/codex'
    }),
    /只能填写可执行文件路径/
  )
})

test('macOS GUI 精简 PATH 能找到 ChatGPT.app 内置的 Codex CLI', {
  skip: process.platform !== 'darwin' || !existsSync('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
}, () => {
  const previousPath = process.env.PATH
  const previousHome = process.env.HOME
  try {
    process.env.PATH = '/usr/bin:/bin'
    process.env.HOME = '/private/tmp/mo-mai-no-codex-home'
    const command = resolveCodexCommand(codexSettings)
    assert.equal(command.program, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex')
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
    if (previousHome === undefined) delete process.env.HOME
    else process.env.HOME = previousHome
  }
})

test('Codex JSONL 事件转换为正文、推理和 token 用量', () => {
  const reasoning = []
  assert.deepEqual(
    parseCodexJsonLine('{"type":"thread.started","thread_id":"0199-session-id"}'),
    { sessionId: '0199-session-id' }
  )
  assert.deepEqual(
    parseCodexJsonLine(
      '{"type":"item.completed","item":{"type":"reasoning","text":"分析中"}}',
      { onTextDelta() {}, onReasoningDelta: (delta) => reasoning.push(delta) }
    ),
    {}
  )
  assert.deepEqual(reasoning, ['分析中'])
  assert.deepEqual(
    parseCodexJsonLine('{"type":"item.completed","item":{"type":"agent_message","text":"完成"}}'),
    { text: '完成' }
  )
  assert.deepEqual(
    parseCodexJsonLine('{"type":"turn.completed","usage":{"input_tokens":12,"output_tokens":8}}'),
    { usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 } }
  )
})

async function withFakeCodex(source, run) {
  const dir = await mkdtemp(join(tmpdir(), 'mo-mai-fake-codex-'))
  const executable = join(dir, 'codex')
  try {
    await writeFile(executable, `#!/usr/bin/env node\n${source}\n`)
    await chmod(executable, 0o755)
    await run(executable)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('本机 Codex 封面模式复用 CLI 登录并读取隔离目录里的 PNG', {
  skip: process.platform === 'win32'
}, async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Y6kAAAAASUVORK5CYII='
  await withFakeCodex(`
    const fs = require('node:fs')
    const path = require('node:path')
    let prompt = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => { prompt += chunk })
    process.stdin.on('end', () => {
      if (!process.argv.includes('workspace-write') || !prompt.includes('$imagegen') || !prompt.includes('cover.png') || prompt.includes('sensitive-image-key')) {
        process.exitCode = 2
        return
      }
      fs.writeFileSync(path.join(process.cwd(), 'cover.png'), Buffer.from(${JSON.stringify(png)}, 'base64'))
      process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 3 } }) + '\\n')
    })
  `, async (codexCliPath) => {
    const result = await generateImageViaCodexCli({ ...codexSettings, codexCliPath, imageProvider: 'codex-cli-local', imageApiKey: 'sensitive-image-key' }, '蓝色圆形封面')
    assert.equal(result.dataUrl, `data:image/png;base64,${png}`)
    assert.equal(result.usage?.totalTokens, 5)
  })
})

test('本机 Codex 未生成真实图片时报告错误，不接受文字路径', {
  skip: process.platform === 'win32'
}, async () => {
  await withFakeCodex(`
    process.stdin.resume()
    process.stdin.on('end', () => {
      process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '/tmp/cover.png' } }) + '\\n')
      process.stdout.write(JSON.stringify({ type: 'turn.completed' }) + '\\n')
    })
  `, async (codexCliPath) => {
    await assert.rejects(
      generateImageViaCodexCli({ ...codexSettings, codexCliPath, imageProvider: 'codex-cli-local' }, '封面'),
      /没有生成封面图片/
    )
  })
})

test('本机生图提示词明确使用 imagegen 并固定输出文件', () => {
  const prompt = buildCodexImagePrompt('玄幻学院', '/tmp/cover.png')
  assert.match(prompt, /^\$imagegen/m)
  assert.match(prompt, /\/tmp\/cover\.png/)
  assert.match(prompt, /玄幻学院/)
})
