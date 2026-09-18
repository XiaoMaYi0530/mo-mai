import type { TaskHandler, PromptBuildInput } from './base'
import { extractJsonObject } from './base'
import type { AiTaskResult, ReferenceProjectBlueprintResult } from '../shared-types'
import { normalizeWorldviewType } from './worldview-type'
import { normalizeOutlineReferenceIds } from './outline-item'

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
}

/**
 * 把拆书结论转换成原创项目骨架。它只接收已经抽象过的拆书资料，不读取参考书全文，
 * 以免浪费上下文，也避免模型通过换名方式复刻原作。
 */
const handler: TaskHandler = {
  name: 'reference-project-blueprint',
  outputType: 'json',
  defaultCapabilities: ['settings', 'analysis', 'worldview', 'outline', 'writing-style'],
  buildPrompt(input: PromptBuildInput) {
    const { context, capabilityPreamble } = input
    const projectPremise = String(context.projectPremise ?? '').trim()
    const selectedConcept = context.selectedConcept && typeof context.selectedConcept === 'object'
      ? JSON.stringify(context.selectedConcept, null, 2)
      : String(context.selectedConcept ?? '').trim()
    const lockedFacts = Array.isArray(context.lockedFacts)
      ? context.lockedFacts.map((item) => String(item).trim()).filter(Boolean)
      : []
    const volumeMode = context.projectVolumeMode === 'manual' ? 'manual' : 'auto'
    const manualVolumePlan = String(context.manualVolumePlan ?? '').trim()
    const volumeInstruction = volumeMode === 'manual'
      ? `采用手动分卷。严格保留用户给出的卷数和卷名，并据阶段目标补足递进关系：\n${manualVolumePlan}`
      : '采用自动分卷。根据主线阶段、地图或身份变化、核心冲突升级和阶段高潮自然划分，不要为了凑固定卷数机械切分。'

    return {
      system: `${capabilityPreamble.system}

你是“原创小说骨架转换器”。参考作品只提供结构研究材料，不是改名仿写模板。
用户原创方向是不可越过的边界，用户选中的故事路线是已经确认的创作决定。你必须沿该路线展开因果链，不得重新发明另一部小说。
只返回 JSON，不要返回 Markdown。

内容优先级（从高到低）：锁定事实 > 用户选中的故事路线 > 分卷要求 > 拆书结构研究。

原创硬约束：
1. 不得沿用参考作品的人名、地名、势力名、能力名、物件名、标志性台词或独有事件组合。
2. 不得按参考作品章节逐章一一对应。相对参考作品至少改变主角身份与核心欲望、冲突来源、世界规则、关键关系、高潮解法中的四项；但用户在锁定事实中明确的内容绝对不能为了凑变化而改动。
3. 可以保留的只有抽象功能，例如“受辱后获得主动权”“阶段胜利引出更大代价”，不能保留具体表达。
4. transformationNotes 必须明确说明完成了哪些结构变换，供用户审阅相似性风险。
5. 禁止擅自改名、换能力、替换世界规则或另造核心矛盾；未出现在锁定事实中的细节才允许补全。`,
      user: `${capabilityPreamble.user}

请基于下列拆书资料，为一个全新的小说项目生成可审阅骨架。

新项目标题：${String(context.projectTitle ?? '')}
新项目题材：${String(context.projectGenre ?? '')}
用户原创方向：${projectPremise}
用户确认的锁定事实：${lockedFacts.length ? lockedFacts.map((fact) => `\n- ${fact}`).join('') : '\n- 以用户原创方向中的明确事实为准'}

【用户已经选中的故事路线（必须据此展开）】
${selectedConcept}

参考作品：${String(context.referenceTitle ?? '')}
深度拆书覆盖率：${String(context.deepAnalysisCoverage ?? '未统计')}
仍缺维度：${Array.isArray(context.missingDeepAnalysisDimensions) ? context.missingDeepAnalysisDimensions.join('、') : '未提供'}
分卷要求：${volumeInstruction}

【已经抽象的拆书资料】
${String(context.referenceStructure ?? '')}

输出要求：
1. blueprintSummary：200-400 字，说明新故事核心卖点、主角目标、主要阻力与长线承诺。
2. transformationNotes：4-8 条，逐条说明相对参考结构做了什么原创化改造。
3. worldviewEntries：4-8 条，只创建直接支撑主线的原创规则。
4. outlineVolumes：每卷只包含 title、summary；卷数由故事的真实阶段决定，不输出总字数、每卷字数或预计章节数。summary 要写出本卷目标、主要阻力、关键转折、卷末不可逆结果及下一卷承接；远期卷只锁定这些里程碑，保留具体过程的调整空间。
5. 采用滚动规划，不要把所有卷平均拆成一两个节点：第一卷优先给出 8-12 个有因果递进的剧情节点，详细规划开局到卷内中段的首次重大转折，但暂不在节点内提前兑现卷末高潮，留下继续扩写的空间；第二卷给出 3-6 个方向节点；更远的卷各保留 1-2 个关键里程碑。若全书只有一卷，也要充分展开该卷。节点数量服务于实际冲突，不靠重复遭遇或机械拆分凑数。
6. outlineItems 的每项包含 volumeIndex（从 0 开始）、title、conflict、summary 和 chapterPlan。第一卷每个节点给出 2-4 个有不同推进作用的近期章节建议，至少形成 16 个可写章节；第二卷及以后 chapterPlan 返回空数组，避免过早锁死远期章节。当前章节建议只是首批规划，不宣称已经覆盖整卷目标字数；写作推进后继续扩展当前卷。
7. chapterPlan 按场景转换、视角切换、冲突阶段与章末钩子决定，不得机械固定章数；每章只包含 title、conflict、summary。新增的第一卷细节必须与后续分卷里程碑兼容，不要为了填篇幅提前兑现后续卷的高潮。
8. 除用户锁定事实外，所有专名必须重新原创；不得在任何字段提及或复现参考作品专名。
9. relatedCharacterIds、relatedOrganizationIds、relatedWorldviewIds 均返回空数组，项目创建后再由用户或助手绑定。

生成前复核：不得修改下列用户原创方向，不得抛弃已选路线另起故事：
【原创方向】${projectPremise}
【已选路线】${selectedConcept}

返回格式：{"blueprintSummary":"","transformationNotes":[""],"worldviewEntries":[{"type":"法则","title":"","content":""}],"outlineVolumes":[{"title":"","summary":""}],"outlineItems":[{"volumeIndex":0,"title":"","conflict":"","summary":"","chapterPlan":[{"title":"","conflict":"","summary":""}],"relatedCharacterIds":[],"relatedOrganizationIds":[],"relatedWorldviewIds":[]}]}`
    }
  },
  normalize(raw: string): AiTaskResult {
    const parsed = extractJsonObject(raw) as Partial<ReferenceProjectBlueprintResult>
    const outlineVolumes = Array.isArray(parsed.outlineVolumes)
      ? parsed.outlineVolumes.slice(0, 12).map((volume, index) => ({
          title: text(volume?.title, `第 ${index + 1} 卷`),
          wordTarget: text(volume?.wordTarget, '100000'),
          summary: text(volume?.summary, '待补充分卷目标。')
        }))
      : []
    const lastVolumeIndex = Math.max(0, outlineVolumes.length - 1)
    const outlineItems = Array.isArray(parsed.outlineItems)
      ? parsed.outlineItems.slice(0, 80).map((item) => ({
          volumeIndex: Math.min(lastVolumeIndex, Math.max(0, Math.trunc(Number(item?.volumeIndex) || 0))),
          title: text(item?.title, '剧情节点'),
          wordTarget: text(item?.wordTarget, '3000'),
          conflict: text(item?.conflict, '待补充冲突。'),
          summary: text(item?.summary, '待补充剧情摘要。'),
          chapterPlan: item?.volumeIndex === 0 && Array.isArray(item?.chapterPlan) && item.chapterPlan.length
            ? item.chapterPlan.slice(0, 12).map((chapter, chapterIndex) => ({
                title: text(chapter?.title, `${text(item?.title, '剧情节点')} · ${chapterIndex + 1}`),
                conflict: text(chapter?.conflict, text(item?.conflict, '待补充冲突。')),
                summary: text(chapter?.summary, text(item?.summary, '待补充剧情摘要。'))
              }))
            : item?.volumeIndex === 0 ? [{
                title: text(item?.title, '剧情节点'),
                conflict: text(item?.conflict, '待补充冲突。'),
                summary: text(item?.summary, '待补充剧情摘要。')
              }] : [],
          relatedCharacterIds: normalizeOutlineReferenceIds(item?.relatedCharacterIds),
          relatedOrganizationIds: normalizeOutlineReferenceIds(item?.relatedOrganizationIds),
          relatedWorldviewIds: normalizeOutlineReferenceIds(item?.relatedWorldviewIds)
        }))
      : []
    const worldviewEntries = Array.isArray(parsed.worldviewEntries)
      ? parsed.worldviewEntries.slice(0, 8).map((entry) => ({
          type: normalizeWorldviewType(entry?.type, '法则'),
          title: text(entry?.title, '原创世界规则'),
          content: text(entry?.content, '待补充设定内容。')
        }))
      : []

    return {
      blueprintSummary: text(parsed.blueprintSummary, '待补充原创故事骨架。'),
      transformationNotes: stringList(parsed.transformationNotes).slice(0, 8),
      worldviewEntries,
      outlineVolumes,
      outlineItems
    } as ReferenceProjectBlueprintResult
  },
  validate(result: AiTaskResult): boolean {
    const value = result as ReferenceProjectBlueprintResult
    return Boolean(
      value.blueprintSummary?.trim()
      && value.transformationNotes?.length >= 3
      && value.worldviewEntries?.length >= 3
      && value.outlineVolumes?.length >= 1
      && value.outlineItems?.filter((item) => item.volumeIndex === 0).length >= 8
      && value.outlineItems
        .filter((item) => item.volumeIndex === 0)
        .reduce((count, item) => count + item.chapterPlan.length, 0) >= 16
    )
  },
  describeValidationErrors(result: AiTaskResult): string[] {
    const value = result as ReferenceProjectBlueprintResult
    const firstVolumeItems = value.outlineItems?.filter((item) => item.volumeIndex === 0) ?? []
    const firstVolumeChapters = firstVolumeItems.reduce((count, item) => count + item.chapterPlan.length, 0)
    const errors: string[] = []
    if (!value.blueprintSummary?.trim()) errors.push('缺少故事骨架摘要')
    if ((value.transformationNotes?.length ?? 0) < 3) errors.push('原创化改造记录至少需要 3 条')
    if ((value.worldviewEntries?.length ?? 0) < 3) errors.push('世界规则至少需要 3 条')
    if (!value.outlineVolumes?.length) errors.push('至少需要 1 个分卷')
    if (firstVolumeItems.length < 8) errors.push(`第一卷至少需要 8 个剧情节点，当前只有 ${firstVolumeItems.length} 个`)
    if (firstVolumeChapters < 16) errors.push(`第一卷至少需要 16 个首批章节建议，当前只有 ${firstVolumeChapters} 个`)
    return errors
  },
  resolveMaxTokens(): number {
    return 12000
  }
}

export default handler
