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

interface LlmResponse {
  summary?: string
  reviews?: ReviewItem[]
}

/** 嵌入评审 body 的隐藏标记，用于识别并清理 inori 的旧评审（多次 push 去重） */
export const REVIEW_MARKER = '<!-- inori-review -->'

/**
 * 剥离 reasoning 模型（MiniMax-M / DeepSeek-R1 / QwQ 等）输出中的
 * `<think>…</think>` 思考过程，只保留正文。
 * 兼容两种形态：正常闭合取闭合标签之后；未闭合（截断）则丢弃思考段。
 * 无 think 标签时为恒等（仅 trim），不影响普通模型输出。
 */
export function stripThink(content: string): string {
  const close = content.lastIndexOf('</think>')
  if (close !== -1) return content.slice(close + '</think>'.length).trim()
  const open = content.indexOf('<think>')
  if (open !== -1) return content.slice(0, open).trim()
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
  let parsed: LlmResponse
  try {
    parsed = JSON.parse(extractJson(content)) as LlmResponse
  } catch {
    // 解析失败时正文兜底也必须剥思考过程，否则思维链会原样贴进 PR
    return { summary: stripThink(content), inlines: [], bodyItems: [] }
  }

  const summary = parsed.summary ?? ''
  const rawReviews = Array.isArray(parsed.reviews) ? parsed.reviews : []

  const inlines: InlineComment[] = []
  const bodyItems: string[] = []
  for (const r of rawReviews) {
    if (typeof r !== 'object' || r === null) continue
    const comment = r.comment ?? ''
    if (!comment) continue
    const severity = r.severity ?? ''
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
    const path = r.path ?? ''
    if (
      typeof line === 'number' &&
      line &&
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
 * 截断发生在追加标记之前，保证标记不被截掉，下一轮才能识别清理。
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
  if (body.length > maxBodyChars) {
    body = `${body.slice(0, maxBodyChars)}\n\n${table.truncated}`
  }
  return `${body}\n\n${REVIEW_MARKER}`
}
