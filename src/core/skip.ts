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
