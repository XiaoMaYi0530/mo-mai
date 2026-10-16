import test from 'node:test'
import assert from 'node:assert/strict'
import handler from './premise-dialog.ts'

function promptInput(context = {}) {
  return {
    context,
    skills: [],
    capabilityPreamble: { system: 'system preamble', user: 'user preamble' },
    skillsBlock: '',
    knowledgeBlock: ''
  }
}

test('简介对话只携带最近十条消息并支持强制生成草稿', () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `消息${index}` }))
  const prompt = handler.buildPrompt(promptInput({
    projectTitle: '测试作品', projectGenre: '玄幻', projectNovelLengthLabel: '长篇', messages, forceDraft: true
  }))
  assert.doesNotMatch(prompt.user, /：消息0\n|：消息1\n/)
  assert.match(prompt.user, /：消息2\n/)
  assert.match(prompt.user, /作者明确要求按现有信息先生成一版/)
})

test('简介对话规范化候选问题并确保 ready 对应有效简介', () => {
  const notReady = handler.normalize('{"reply":"先确定主角代价。","questions":["失去身份","失去亲人","失去自由","多余选项"],"premise":"","ready":true}')
  assert.equal(notReady.ready, false)
  assert.equal(notReady.questions.length, 3)
  assert.equal(handler.validate(notReady), true)

  const ready = handler.normalize('{"reply":"钩子已经成立。","questions":[],"premise":"主角为了救回失踪的妹妹，被迫进入一座只允许失败者离开的学院。","ready":true}')
  assert.equal(ready.ready, true)
  assert.equal(handler.validate(ready), true)
})
