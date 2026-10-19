/** Shared boundary for IPC links and window.open; no custom OS protocols. */
export function normalizeExternalWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value) || !/^https?:\/\//i.test(value)) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.href
  } catch { return null }
}
export async function openExternalWebUrl(value: unknown, open: (url: string) => Promise<void>): Promise<{ success: boolean; error?: string }> {
  const url = normalizeExternalWebUrl(value)
  if (!url) return { success: false, error: '仅支持不含账号密码的 HTTP/HTTPS 网页地址。' }
  try { await open(url); return { success: true } }
  catch { return { success: false, error: '无法打开浏览器，请检查系统默认浏览器设置。' } }
}
