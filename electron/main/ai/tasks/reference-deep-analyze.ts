import type { TaskHandler, PromptBuildInput } from './base'
import { normalizeAssistantText } from './base'
import type { AiTaskResult, ChapterAssistantResult } from '../shared-types'

/**
 * 深度拆书 task。
 *
 * 不像 `reference-style-analysis` 单次产出一份 JSON，本 task 走 agent loop：
 *   1. 模型按墨脉原生拆书维度分析内容
 *   2. 风格维度按需加载“风格指纹提取”及其结构模板
 *   3. 对用户提供的参考小说原文逐维度拆解，每个维度（总纲 / 角色 / 故事线 / 场景）调一次
 *      knowledge_save_document 落库
 *   4. 全部存完后给一句确认文案就结束
 *
 * 不输出 JSON——拆书结果都通过 knowledge_save_document 工具落库；模型最后的 text 仅用作确认。
 * agent/index.ts 会把 collect 到的 AiKnowledgeDocumentDraft[] 挂在 meta.producedKnowledgeDocuments，
 * renderer 接收 ai-run-event 时自动 merge 进 knowledgeDocuments。
 */
const handler: TaskHandler = {
  name: 'reference-deep-analyze',
  outputType: 'text',
  defaultCapabilities: ['settings', 'analysis', 'writing-style', 'project-skills'],
  maxSkills: 1,
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble, skillsBlock } = input

    const referenceTitle = String(context.referenceTitle ?? '').trim() || '未命名参考作品'
    const referenceGenre = String(context.referenceGenre ?? '').trim() || '未指明'
    const referenceFileName = String(context.referenceFileName ?? '').trim() || ''
    const sourceText = String(context.sourceText ?? '').trim()
    const targetGenre = String(context.projectGenre ?? '').trim() || '未指明'
    const targetTitle = String(context.projectTitle ?? '').trim() || '当前项目'
    const progressSummary = String(context.deepAnalysisPlan ?? '').trim()
    const sourceCoverage = String(context.deepAnalysisSourceCoverage ?? '').trim()
    const targetDimensions = Array.isArray(context.deepAnalysisTargetDimensionIds)
      ? context.deepAnalysisTargetDimensionIds.map((item) => String(item).trim()).filter(Boolean)
      : []
    const targetInstruction = targetDimensions.length
      ? `本轮只生成这些缺失维度：${targetDimensions.join('、')}`
      : '本轮重新生成全部维度，并按稳定维度标识更新旧结果'

    return {
      system: `${capabilityPreamble.system}

你是一个**拆书 agent**，工作在墨脉的“知识中心”管线里。
本次任务：把一本参考小说**深度拆解**为多份结构化知识文档，落库后供后续写作时检索复用。

## 强制工作流程

1. 原文、覆盖进度与可用风格方法已经由宿主直接注入，不要调用 skill_load、
   skill_read_reference、读取项目资料或其他预备工具。
2. 只处理“本轮目标维度”，不要重复生成已有维度。
3. **第一轮回复就直接发出 knowledge_save_document 工具调用**。可以在同一轮为多个维度
   分别调用一次，禁止把保存拖到分析完成之后。

## 必须产出的维度（每个一份独立 knowledge_save_document）

| 维度 | sourceType | 标题示例 |
|---|---|---|
| 整体拆书总纲（风格 / 视角 / 节奏 / 题材定位 / 卖点） | reference-summary | 《xxx》｜深度拆书总纲 |
| 主角画像（动机 / 弱点 / 成长弧） | reference-chunk | 《xxx》｜主角：xxx |
| 关键配角与反派（合并为一份） | reference-chunk | 《xxx》｜关键配角与反派 |
| 主线故事线骨架 | reference-chunk | 《xxx》｜主线：xxx |
| 关键支线 / 副线（每条一份，可选） | reference-chunk | 《xxx》｜支线：xxx |
| 黄金三章桥段拆解（合并为一份） | reference-chunk | 《xxx》｜黄金三章桥段拆解 |
| 设定 / 世界观（如金手指、力量体系等，合并为一份） | reference-chunk | 《xxx》｜世界观与力量体系 |
| 风格指纹（精简可执行版） | reference-summary | 《xxx》｜叙事风格指纹 |

每份 content 必须是结构化 markdown，便于后续被 retrieval 拉出来用。
keywords 务必填 3-8 个（人物名、桥段类型、关键设定词等），让检索能命中。
metadata 必须填写 analysisDimension 和 analysisKey，取值如下：
- overview / protagonist / mainline / opening / supporting / worldbuilding / style
- 每个维度的 analysisKey 使用同名英文值，确保重试时只更新对应维度。

## 风格分析兜底结构

如果上方没有注入“风格指纹”Skill，仍须使用以下内置基础结构完成 style 维度：
叙事视角、句式与段落节奏、对话比例与机制、描写密度、情绪表达、冲突与爽点节奏、
常用章法，以及禁止照搬的专名和情节。Skill 是增强项，不是深度拆书的硬依赖。

## 关键约束

- **不要照抄原文长段**——拆书是提炼方法论 / 桥段功能 / 角色逻辑，不是搬运。
- 涉及人名 / 地名 / 势力名只在 metadata 里保留，content 主体用"主角"、"反派 A"、"势力 B"等通用代称，
  方便当前项目的写作 agent 复用模式而不照搬专名。
- 如果输出预算不足，优先保存**总纲 + 主角 + 主线 + 黄金开篇**，未完成维度留给下次断点续作。
- 已有维度必须保留；本轮只更新明确列出的目标维度。

## 完成标志

本轮目标维度至少成功落库 1 份后，给出一段简短中文总结，明确“本轮新增/更新 N 个维度、
还缺哪些维度”。不要返回普通 JSON。`,
      user: `${capabilityPreamble.user}

## 当前任务上下文

- 当前项目：${targetTitle}（题材：${targetGenre}）
- 参考作品：${referenceTitle}（题材：${referenceGenre}${referenceFileName ? `，原文件：${referenceFileName}` : ''}）
- 覆盖进度：${progressSummary || '尚未检测到已完成的深度拆书维度'}
- 本轮原文取样：${sourceCoverage || '未提供取样范围'}
- ${targetInstruction}

## 参考小说原文（节选 / 全文）

${sourceText || '（未提供原文文本——请告诉用户需要先提供原文。）'}

## 已直接注入的风格分析方法（可能为空）

${skillsBlock || '（参考 system prompt 顶部的 skill 索引）'}

## 行动指令

按 system prompt 里"强制工作流程"推进，第一轮立即为本轮目标维度调用 knowledge_save_document。
不要先加载 Skill，不要重新生成进度中标为已有的维度。`
    }
  },
  normalize(raw: string): AiTaskResult {
    return normalizeAssistantText(raw) as AiTaskResult
  },
  validate(result: AiTaskResult): boolean {
    // 不强制非空——即使 model 没说话，只要工具调用产出了 knowledge 文档就算成功；
    // agent/index.ts 会单独检查 meta.producedKnowledgeDocuments 是否为空。
    return typeof (result as ChapterAssistantResult).content === 'string'
  },
  resolveMaxTokens(): number {
    // 给 agent 多轮工具调用足够预算——每轮一个工具调用 + 一段总结，整个 loop 可能跑 10K+ token
    return 8000
  }
}
export default handler
