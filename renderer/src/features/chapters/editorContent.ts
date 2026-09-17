import { chapterHtmlToPlainText } from '@shared/chapter-text.ts'

// 匹配 HTML 标签的正则，用于判断内容是富文本还是纯文本
const HTML_TAG_PATTERN = /<\/?[a-z][\s\S]*>/i

// 将字符串中的特殊字符转义为 HTML 实体，防止 XSS 和富文本解析问题
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 判断内容是否为富文本（包含 HTML 标签）
export function isRichTextDocument(content: string): boolean {
  return HTML_TAG_PATTERN.test(content)
}

// 将纯文本内容序列化为 HTML：
// 以双换行分段为 <p> 标签，段内单换行转为 <br />，同时转义特殊字符
export function serializePlainTextToHtml(content: string): string {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  if (!normalized) {
    return '<p></p>'
  }

  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('')
}

// 确保编辑器内容始终为 HTML 格式：
// 空内容返回空段落标签，纯文本自动转为 HTML，富文本原样返回
export function ensureEditorHtmlContent(content: string): string {
  const normalized = content.trim()
  if (!normalized) {
    return '<p></p>'
  }

  return isRichTextDocument(normalized) ? normalized : serializePlainTextToHtml(normalized)
}

// 从 HTML 内容中提取纯文本：
// 将 <br>、块级标签转为换行，列表项转为 "- " 前缀，去除所有标签后解码实体
// 最终压缩连续空行，返回干净的纯文本
export function getPlainTextFromEditorContent(content: string): string {
  return chapterHtmlToPlainText(content)
}

// 获取章节正文的字符数（去除空白后的纯文本长度）
export function getChapterCharacterCount(content: string): number {
  return getPlainTextFromEditorContent(content).trim().length
}

// 获取章节正文的预览文本：将纯文本中连续空白压缩为单个空格
// 无内容时返回 fallback 默认提示文案
export function getChapterPreviewText(content: string, fallback = '章节尚未写入正文内容。'): string {
  const preview = getPlainTextFromEditorContent(content).replace(/\s+/g, ' ').trim()
  return preview || fallback
}
