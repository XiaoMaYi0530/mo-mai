import { decodeReadReceipt } from '../../../shared/project-read-receipt.ts'
import type { Tool, ToolContext } from '../agent/tools/types'
export function requestsFullCharacterReview(prompt: string): boolean {
  if (/(?:不要|不用|无需|不必|别)[^，。；\n]{0,24}(?:全部|所有|全体)(?:人物|角色)|(?:don.t|do not)\s+(?:review|read|check)\s+all/i.test(prompt)) return false
  return /(?:检查|审查|审阅|核对|分析|读取|阅读|读完|通读)[\s\S]{0,16}(?:全部|所有|全体)[\s\S]{0,8}(?:人物|角色)|(?:全部|所有|全体)(?:人物|角色)[\s\S]{0,16}(?:检查|审查|核对|分析)|(?:review|read|check)\s+all\s+(?:characters|character cards)/i.test(prompt)
}
/** Programme-owned paging. Each bounded batch is reviewed before moving to the next. */
export async function reviewAllCharacters(deps: {
  tool: Tool; ctx: ToolContext; onRead: (id: string, args: Record<string, unknown>, content?: string, error?: boolean) => void
  review: (body: string, batch: number) => Promise<string>; onProgress: (text: string) => void
}): Promise<string> {
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
      const report = await deps.review(body, cursor+1)
      if (!report.trim()) throw new Error('本批人物审查未返回结果，未继续后续批次。')
      reports.push(`## 第 ${cursor+1} 批：${receipt.items.map(i=>i.title).join('、')}\n${report}`)
    }
    if (receipt.nextCursor === undefined) break
    cursor = receipt.nextCursor
  }
  deps.onProgress('全部人物资料已分批读取并审查，正在汇总。')
  return reports.join('\n\n') || '当前项目没有人物卡。'
}
