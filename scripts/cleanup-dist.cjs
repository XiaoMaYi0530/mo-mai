const fs = require('node:fs')
const path = require('node:path')

const KEEP_VERSION_COUNT = 3
const distDir = path.resolve(__dirname, '..', 'dist')
const artifactPattern = /^(?:CharacterArc|墨脉)-(\d+)\.(\d+)\.(\d+)-mac-[^.]+\.(dmg|zip)(?:\.blockmap)?$/

function compareVersionsDesc(a, b) {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index]
  }
  return 0
}

if (!fs.existsSync(distDir)) process.exit(0)

const entries = fs.readdirSync(distDir)
const parsed = entries.flatMap((name) => {
  const match = name.match(artifactPattern)
  if (!match) return []
  return [{
    name,
    version: `${match[1]}.${match[2]}.${match[3]}`,
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    kind: match[4],
    blockMap: name.endsWith('.blockmap')
  }]
})

const versions = [...new Map(parsed.map((item) => [item.version, item.parts])).entries()]
  .sort((left, right) => compareVersionsDesc(left[1], right[1]))
  .map(([version]) => version)
const retainedVersions = new Set(versions.slice(0, KEEP_VERSION_COUNT))
const removals = parsed.filter((item) => item.kind === 'zip' || item.blockMap || !retainedVersions.has(item.version))

for (const item of removals) {
  const target = path.join(distDir, item.name)
  fs.rmSync(target)
  console.log(`Removed old build artifact: ${item.name}`)
}

for (const name of ['.DS_Store', 'builder-debug.yml', 'builder-effective-config.yaml', 'latest-mac.yml']) {
  const target = path.join(distDir, name)
  if (!fs.existsSync(target)) continue
  fs.rmSync(target)
  console.log(`Removed build metadata: ${name}`)
}

for (const name of fs.readdirSync(distDir)) {
  if (name !== '.icon-icns' && !/^mac(?:-(?:arm64|x64|universal))?$/.test(name)) continue
  const target = path.join(distDir, name)
  if (!fs.statSync(target).isDirectory()) continue
  fs.rmSync(target, { recursive: true })
  console.log(`Removed unpacked build directory: ${name}`)
}

console.log(`Retained DMG versions: ${versions.slice(0, KEEP_VERSION_COUNT).join(', ') || '(none)'}`)
