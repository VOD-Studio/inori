import { isIgnored } from './diff'
import type { Lang } from './i18n'

// ── 智能早退判定（草稿 PR / Bot PR / 指定作者）──

export interface SkipCheckParams {
  isDraft?: boolean
  skipDraft?: boolean
  author?: { login?: string; type?: string }
  ignoreBots?: boolean
  ignoreAuthors?: string[]
  lang?: Lang
}

export interface SkipResult {
  skip: boolean
  reason?: string
}

export function shouldSkipReview(params: SkipCheckParams): SkipResult {
  const isZh = (params.lang ?? 'zh') === 'zh'

  // 1. 草稿 PR
  if (params.skipDraft && params.isDraft) {
    return {
      skip: true,
      reason: isZh ? '跳过草稿 PR 评审' : 'Skipping draft PR review',
    }
  }

  const login = params.author?.login ?? ''
  const type = params.author?.type ?? ''

  // 2. Bot PR（仅认 GitHub 官方信号：账号 type=Bot，或 "[bot]" 后缀的
  //    App 账号登录名；不做 "-bot" 之类的启发式猜测，真人可自行加入 ignore_authors）
  if (params.ignoreBots) {
    const isBot = type.toLowerCase() === 'bot' || login.toLowerCase().endsWith('[bot]')
    if (isBot) {
      return {
        skip: true,
        reason: isZh ? `跳过 Bot PR 评审 (${login})` : `Skipping bot PR review (${login})`,
      }
    }
  }

  // 3. 指定作者忽略
  if (params.ignoreAuthors && params.ignoreAuthors.length > 0 && login) {
    const matched = params.ignoreAuthors.some((a) => a.toLowerCase() === login.toLowerCase())
    if (matched) {
      return {
        skip: true,
        reason: isZh
          ? `跳过指定作者 PR 评审 (${login})`
          : `Skipping ignored author PR review (${login})`,
      }
    }
  }

  return { skip: false }
}

// ── 路径级整体跳过 ──

/**
 * 判定 PR 全部变更文件是否命中跳过路径——纯此类变更的 push 无代码语义，
 * 整体跳过评审（与 ignore_patterns 的内容过滤正交：那是把文件从评审
 * 上下文剔除，这里是声明「只改这些的 PR 不需要评审」）。
 *
 * 空文件列表视为无可判定内容，不跳过（交由后续空 diff 早退兜底）。
 */
export function shouldSkipByPaths(filenames: string[], patterns: string[]): SkipResult {
  if (patterns.length === 0 || filenames.length === 0) return { skip: false }
  const allMatched = filenames.every((f) => isIgnored(f, patterns))
  if (!allMatched) return { skip: false }
  return {
    skip: true,
    reason: `全部 ${filenames.length} 个变更文件命中跳过路径，无代码语义，跳过评审`,
  }
}
