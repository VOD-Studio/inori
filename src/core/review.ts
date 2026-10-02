import { type Lang, t } from './i18n'

/** 模型输出的单条评审条目 */
export interface ReviewItem {
  path?: string
  line?: number
  severity?: string
  comment?: string
  coding_plan?: string
}
/** 通过 inline 评论发布的条目（已格式化展示文本） */
export interface InlineComment {
  path: string
  line: number
  body: string
}

/** 嵌入评审 body 的隐藏标记，用于识别并清理 inori 的旧评审（多次 push 去重） */
export const REVIEW_MARKER = '<!-- inori-review -->'

/**
 * 剥离 reasoning 模型（MiniMax-M / DeepSeek-R1 / QwQ 等）输出中的
 * `<think>…</think>` 思考过程，只保留正文。
 * 未闭合的思考段意味着输出未完成，必须拒绝作为评审结果。
 * 无 think 标签时为恒等（仅 trim），不影响普通模型输出。
 */
export function stripThink(content: string): string {
  const close = content.lastIndexOf('</think>')
  if (content.lastIndexOf('<think>') > close) {
    throw new Error('LLM 评审输出未完成：think 标签未闭合')
  }
  if (close !== -1) return content.slice(close + '</think>'.length).trim()
  return content.trim()
}

/**
 * 从模型输出中提取 JSON 文本。模型常无视「不要代码块」的指令，
 * 先剥离思考过程与 ``` 围栏，再按最外层花括号截取（容忍围栏外的说明文字）。
 */
export function extractJson(content: string): string {
  let s = stripThink(content)
  const fenced = s.match(/^```[\w-]*\s*([\s\S]*?)\s*```$/)
  if (fenced) s = fenced[1].trim()
  if (s.startsWith('[') || s.startsWith('"')) return s
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start !== -1 && end > start) s = s.slice(start, end + 1)
  return s
}

/**
 * 解析模型 JSON 输出。
 * inline 锚点行号必须落在对应文件 patch 的新增行上，否则降级到 body 清单。
 */
export function parseReviews(
  content: string,
  fileLines: Map<string, Set<number>>,
  lang: Lang = 'zh',
): { summary: string; inlines: InlineComment[]; bodyItems: string[] } {
  const json = extractJson(content)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('LLM 评审输出不是有效 JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('LLM 评审输出必须是 JSON 对象')
  }
  if (!('summary' in parsed) || typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
    throw new Error('LLM 评审输出缺少非空 summary 字符串')
  }
  if (!('reviews' in parsed) || !Array.isArray(parsed.reviews)) {
    throw new Error('LLM 评审输出缺少 reviews 数组')
  }
  const summary = parsed.summary.trim()
  const rawReviews: unknown[] = parsed.reviews

  const inlines: InlineComment[] = []
  const bodyItems: string[] = []
  for (const [index, item] of rawReviews.entries()) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new Error(`LLM 评审条目 ${index + 1} 必须是对象`)
    }
    const r = item as Record<string, unknown>
    if (typeof r.comment !== 'string' || !r.comment.trim()) {
      throw new Error(`LLM 评审条目 ${index + 1} 缺少非空 comment 字符串`)
    }
    if (
      (r.path !== undefined && typeof r.path !== 'string') ||
      (r.severity !== undefined && typeof r.severity !== 'string')
    ) {
      throw new Error(`LLM 评审条目 ${index + 1} 的 path 或 severity 类型无效`)
    }
    const comment = r.comment.trim()
    const severity = typeof r.severity === 'string' ? r.severity : ''
    let text = severity ? `**[${severity}]** ${comment}` : comment
    if (typeof r.coding_plan === 'string' && r.coding_plan.trim()) {
      const heading = t(lang).codingPlanHeading
      const planBlock = r.coding_plan
        .trim()
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
      text += `\n\n> **${heading}**\n${planBlock}`
    }
    const line = r.line
    const path = typeof r.path === 'string' ? r.path : ''
    if (
      typeof line === 'number' &&
      Number.isInteger(line) &&
      line > 0 &&
      path &&
      fileLines.has(path) &&
      fileLines.get(path)?.has(line)
    ) {
      inlines.push({ path, line, body: text })
    } else {
      bodyItems.push(path ? `- ${text}（${path}）` : `- ${text}`)
    }
  }
  return { summary, inlines, bodyItems }
}

/**
 * 组装评审 body：标题（含模型名）+ 结论 + 其他问题清单。
 * 超出完整正文预算时拒绝发布，避免把遗漏发现的结果报告为完整评审。
 */
export function buildReviewBody(
  opts: { summary: string; bodyItems: string[]; model: string },
  lang: Lang,
  maxBodyChars: number,
): string {
  const table = t(lang)
  let body = `${table.reviewTitle} · ${opts.model}\n\n${table.summaryHeading}\n${opts.summary || table.noIssues}`
  if (opts.bodyItems.length) {
    body += `\n\n${table.othersHeading}\n${opts.bodyItems.join('\n')}`
  }
  body += `\n\n${REVIEW_MARKER}`
  const limit = Math.min(Math.floor(maxBodyChars), 65536)
  if (!Number.isFinite(limit) || body.length > limit) {
    throw new Error('评审正文超出 max_body_chars 或 GitHub 长度限制，无法完整发布')
  }
  return body
}
