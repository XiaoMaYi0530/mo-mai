import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { APP_GITHUB_REPOSITORY, APP_GITHUB_RELEASES_API } from './app-brand.ts'
import { githubCacheKey } from './github-cache-key.ts'
import { normalizeExternalWebUrl, openExternalWebUrl } from './external-url.ts'
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
test('外链仅打开网页，拒绝系统协议、畸形地址、控制字符和嵌入凭据', async()=>{
  const calls=[]
  for(const input of ['file:///etc/passwd','javascript:alert(1)','data:text/html,x','mailto:a@b.com','https://','https://user:pass@example.com','https://example.com\n','https:example.com',null,{}]) {
    assert.equal(normalizeExternalWebUrl(input),null)
    assert.equal((await openExternalWebUrl(input,async url=>calls.push(url))).success,false)
  }
  assert.equal(calls.length,0)
  assert.deepEqual(await openExternalWebUrl('https://github.com/XiaoMaYi0530/mo-mai',async url=>calls.push(url)),{success:true})
  assert.equal(calls.length,1)
  assert.equal(normalizeExternalWebUrl('http://localhost:3000/path'),'http://localhost:3000/path')
  assert.equal((await openExternalWebUrl('https://example.com',async()=>{throw Error('OS failure')})).success,false)
})
test('项目链接统一且两个外链入口都经过共同校验', async()=>{
  const pkg=JSON.parse(await read('../../package.json')), tutorial=JSON.parse(await read('../../tutorial.json'))
  assert.equal(APP_GITHUB_REPOSITORY,'XiaoMaYi0530/mo-mai')
  assert.equal(pkg.repository.url,`https://github.com/${APP_GITHUB_REPOSITORY}.git`)
  assert.equal(APP_GITHUB_RELEASES_API,`https://api.github.com/repos/${APP_GITHUB_REPOSITORY}/releases/latest`)
  assert.equal(tutorial.resources.find(r=>r.type==='github').url,`${pkg.homepage}/blob/main/docs/user-guide.md`)
  assert.match(await read('../../.github/workflows/release.yml'),/RELEASE_REPOSITORY: \$\{\{ github.repository \}\}/)
  for(const file of ['./window-manager.ts','./register-main-ipc.ts'])assert.match(await read(file),/openExternalWebUrl\(url, target => shell.openExternal\(target\)\)/)
})
test('缓存身份包含仓库分支路径，过期回退使用同一来源身份', async()=>{
  const key=githubCacheKey('owner/repo','main','tutorial.json')
  assert.equal(key,githubCacheKey('owner/repo','main','tutorial.json'))
  const cache=new Map([[key,{data:'原来源'}]])
  assert.equal(cache.get(githubCacheKey('another/repo','main','tutorial.json')),undefined)
  assert.equal(cache.get(githubCacheKey('owner/repo','dev','tutorial.json')),undefined)
  assert.equal(cache.get(githubCacheKey('owner/repo','main','announcements.json')),undefined)
  const source=await read('./github-mirror.ts')
  assert.match(source,/readCache\(cacheDir, cacheKey\)/)
  assert.match(source,/writeCache\(cacheDir, cacheKey,/)
  assert.doesNotMatch(source,/readCache\(cacheDir, path\)/)
})
test('原作者署名与安装身份保持兼容，第三方预设显式标记', async()=>{
  const pkg=JSON.parse(await read('../../package.json'))
  assert.equal(pkg.build.appId,'com.characterarc.desktop')
  assert.match(await read('./index.ts'),/APP_DATA_DIR_NAME = 'CharacterArc'/)
  assert.match(await read('../../LICENSE'),/Copyright \(c\) 2025 zhouyeshan/)
  assert.match(await read('../../renderer/src/features/settings/imageProviderPresets.ts'),/云雾 AI · 第三方/)
})
