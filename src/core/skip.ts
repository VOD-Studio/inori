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

// ── 提交标识级整体跳过 ──

/**
 * 判定 PR 全部 commit 的 message 是否命中跳过前缀——纯 ci:/docs:/chore:
 * 类提交无代码语义，整体跳过评审。
 *
 * 全部命中才跳过：混合了任一非跳过前缀 commit 即照常评审（PR 语义以
 * 代码变更为准）。commit message 取首行（subject），忽略大小写。
 * squashed 后的 subject 以触发 push 的 head commit 为准。
 */
export function shouldSkipByCommitPrefixes(subjects: string[], prefixes: string[]): SkipResult {
  if (prefixes.length === 0 || subjects.length === 0) return { skip: false }
  // 前缀归一为裸 type（"ci:"），subject 按 Conventional Commits 解析 type
  // 再比对：ci(ai-review): x 命中，circle: 不误中；非 CC 格式退回整串前缀匹配
  const types = prefixes.map((p) => p.trim().toLowerCase().replace(/:$/, ''))
  const subjectType = (s: string): string => {
    const m = /^\(?([a-z]+)(?:\([^)]*\))?!?:/.exec(s.trim().toLowerCase())
    return m ? m[1] : s.trim().toLowerCase()
  }
  const allMatched = subjects.every((s) =>
    types.some((t) => subjectType(s) === t || s.trim().toLowerCase().startsWith(`${t}:`)),
  )
  if (!allMatched) return { skip: false }
  return {
    skip: true,
    reason: `全部 ${subjects.length} 个 commit 命中跳过前缀（${prefixes.join(', ')}），无代码语义，跳过评审`,
  }
}
