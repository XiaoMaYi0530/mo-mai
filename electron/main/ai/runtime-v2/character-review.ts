import { createHash } from 'node:crypto'
import { decodeReadReceipt } from '../../../shared/project-read-receipt.ts'
import type { Tool, ToolContext } from '../agent/tools/types'
export function requestsFullCharacterReview(prompt: string): boolean {
  if (/(?:不要|不用|无需|不必|别)[^，。；\n]{0,24}(?:全部|所有|全体)(?:人物|角色)|(?:don.t|do not)\s+(?:review|read|check)\s+all/i.test(prompt)) return false
  if (/^继续(?:上次|之前的)?(?:全部|所有)?(?:人物|角色)(?:审查|检查|审阅)/.test(prompt.trim())) return true
  return /(?:检查|审查|审阅|核对|分析|读取|阅读|读完|通读)[\s\S]{0,16}(?:全部|所有|全体)[\s\S]{0,8}(?:人物|角色)|(?:全部|所有|全体)(?:人物|角色)[\s\S]{0,16}(?:检查|审查|核对|分析)|(?:review|read|check)\s+all\s+(?:characters|character cards)/i.test(prompt)
}
export interface CharacterReviewCheckpoint { prompt: string; results: Record<string,string>; summaries: Record<string,string> }
export function characterReviewKey(body: string) { return createHash('sha256').update(body).digest('hex') }
/** Programme-owned paging. Each bounded batch is reviewed before moving to the next. */
export async function reviewAllCharacters(deps: {
  tool: Tool; ctx: ToolContext; onRead: (id: string, args: Record<string, unknown>, content?: string, error?: boolean) => void
  checkpoint?: CharacterReviewCheckpoint; saveCheckpoint?: (checkpoint: CharacterReviewCheckpoint) => void
  review: (body: string, batch: number) => Promise<string>; onProgress: (text: string) => void
}): Promise<string> {
  const checkpoint = deps.checkpoint ?? { prompt: '', results: {}, summaries: {} }
  const reports: string[] = []
  let cursor = 0
  const seen = new Set<number>()
  for (;;) {
    deps.ctx.signal.throwIfAborted()
    if (seen.has(cursor)) throw new Error('人物资料游标重复，停止以避免遗漏或重复审查。')
    seen.add(cursor)
    const args = { entity_type: 'characters', scan_cursor: cursor }
    const id = `character-review-${cursor}`
    deps.onRead(id, args)
    const result = await deps.tool.handler(args, deps.ctx)
    deps.onRead(id, args, result.content, result.isError)
    if (result.isError) throw new Error(result.content)
    const { receipt, body } = decodeReadReceipt(result.content)
    if (!receipt) throw new Error('人物读取未完成：未收到有效读取记录，请检查读取预算后重试。')
    deps.onProgress(`正在审查第 ${cursor+1} 批人物资料（共 ${receipt.total} 位人物，可随时停止）。`)
    if (receipt.total) {
      const key = characterReviewKey(JSON.stringify(receipt.items) + body)
      const reused = checkpoint.results[key]
      if (reused) deps.onProgress(`第 ${cursor+1} 批资料未变，复用已保存的审查结论。`)
      const report = reused || await deps.review(body, cursor+1)
      if (!report.trim()) throw new Error('本批人物审查未返回结果，未继续后续批次。')
      checkpoint.results[key] = report
      deps.saveCheckpoint?.(checkpoint)
      reports.push(`## 第 ${cursor+1} 批：${receipt.items.map(i=>i.title).join('、')}\n${report}`)
    }
    if (receipt.nextCursor === undefined) break
    cursor = receipt.nextCursor
  }
  deps.onProgress('全部人物资料已分批读取并审查，正在汇总。')
  let combined = reports.join('\n\n')
  while (combined.length > 24000) {
    deps.ctx.signal.throwIfAborted()
    deps.onProgress('分批结论较多，正在分层汇总；已完成的结论已保存。')
    const reduced: string[] = []
    for (let offset = 0; offset < combined.length; offset += 16000) {
      deps.ctx.signal.throwIfAborted()
      const body = combined.slice(offset, offset + 16000)
      const key = characterReviewKey(body)
      const summary = checkpoint.summaries[key] || await deps.review('汇总以下已完成的审查记录，保留人物 ID、事实冲突和待核对事项，不增加新事实：\n' + body, 0)
      if (!summary.trim()) throw new Error('汇总未返回结果，已完成的分批结论可继续使用。')
      checkpoint.summaries[key] = summary
      deps.saveCheckpoint?.(checkpoint)
      reduced.push(summary)
    }
    const next = reduced.join('\n\n')
    if (next.length >= combined.length) throw new Error('模型未能压缩汇总，已保存分批结论，请换模型后继续。')
    combined = next
  }
  return combined || '当前项目没有人物卡。'
}
